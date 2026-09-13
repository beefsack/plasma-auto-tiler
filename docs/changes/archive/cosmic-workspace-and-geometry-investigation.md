# COSMIC Workspace And Geometry Investigation

## Scope

- Diagnose two pending architecture decisions only. No engine, contract, adapter,
  model, or live-KWin change is part of this record.
- Audited COSMIC source is `pop-os/cosmic-comp`
  `81cd5fdbaa41c3973369ae85bccf829137836e20`.

## Q1: Workspace Mapping

### Evidence

- COSMIC exposes `WorkspaceMode::{OutputBound, Global}` in
  [`cosmic-comp-config/src/workspace.rs`](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/cosmic-comp-config/src/workspace.rs#L33-L45).
  `OutputBound` is the default. `Workspaces` stores an `IndexMap<Output,
  WorkspaceSet>` and reads that setting in
  [`src/shell/mod.rs`](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/mod.rs#L824-L842).
- In `OutputBound`, `refresh` maintains trailing-empty workspaces separately in
  each set. In `Global`, it pads every set to the same length and synchronizes
  their active index ([`refresh`](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/mod.rs#L1248-L1315)).
  `migrate_workspace` explicitly refuses `Global`, because spanning workspaces
  cannot move between outputs ([`migrate_workspace`](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/mod.rs#L1025-L1046)).
- KWin's documented scripting API exposes one global `desktops` collection,
  `currentDesktopForScreen(output)`, and
  `setCurrentDesktopForScreen(desktop, output)`. A window has a single `output`
  and a `desktops` membership list; an empty list means all desktops. It also
  exposes one read-write `currentActivity`, not an output-scoped activity.
  See [KWin scripting API](https://develop.kde.org/docs/plasma/kwin/api/#kwinworkspacewrapper)
  and its [Window desktop/activity properties](https://develop.kde.org/docs/plasma/kwin/api/#kwinwindow).
- This API is reachable from the project: `kwin/src/kwin-globals.d.ts:119-145,
  274-325` declares the window membership, desktop collection, per-screen
  current-desktop, creation/removal, and per-screen setter. The current Rust
  adapter already observes one `(output, desktop)` pair through
  `currentDesktopForScreen` and filters membership in
  `kwin/src/plan-adapter-entry.ts:323-419`.

### Verdict And Recommendation

- Verdict: **does not map, project-owned mechanism required**.
- COSMIC's default is independent, output-owned workspace sets, including
  independent lifecycle and workspace migration. KWin's per-screen capability
  selects from one shared desktop pool: a desktop can be selected on multiple
  outputs and a window can belong to multiple desktops. Activities are global.
  Neither has COSMIC's output-local workspace identity or lifecycle.
- COSMIC `Global` resembles KWin's switch-together behavior, but remains not a
  clean identity/lifecycle map: COSMIC retains one set per output and keeps their
  indices synchronized; KWin has shared desktop identities. It is not a safe
  conditional escape hatch.
- Reuse or adapt a project-owned `N outputs x M logical workspaces` multiplexing
  layer, assigning distinct native desktops per output/workspace and treating
  native desktops only as backing storage. The legacy design is documented in
  `README.md:334-357`; it is evidence that the required KWin operations exist,
  not evidence that a portable adapter route already exists.
- This is medium, not thin, adapter work: define and persist the output/local
  desktop mapping; observe membership/current-desktop/output changes; create,
  select, and retire owned backing desktops; move windows; handle hotplug and
  validate isolation. Activities should not be a route. Keep this pending user
  selection before implementation.

## Q2: Pixel Sizes Versus Shares

### Evidence

- COSMIC `Data::Group` stores `Vec<i32> sizes` plus `last_geometry`.
  `new_group` truncates halves; add rounds surviving scaled pixel sizes and puts
  the residual in the inserted child; removal and `update_geometry` round and
  correct the final child; layout uses running integer offsets. See
  [`tiling/mod.rs:150-154`](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs#L150-L154),
  [`177-191`](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs#L177-L191),
  [`219-320`](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs#L219-L320),
  and [`3098-3117`](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs#L3098-L3117).
- Portable `Node::Group` stores positive `Vec<u64> shares`; `geometry::project`
  reserves one pixel per child, floors each non-final proportional allocation,
  and gives the last child the remainder (`src/geometry.rs:70-105,143-265`).
  Admission/removal preserve exact share ratios (`src/cosmic_v1.rs:109-198`).

### Q2(a): Observable Divergence

All examples omit gaps to isolate allocation.

| Scenario | COSMIC pixels | Portable shares/projected pixels | Difference |
| --- | --- | --- | --- |
| 1000px binary `[500,500]`, six keyboard moves shrinking left by `12,14,16,18,20,20`px | `[488,512]`, `[474,526]`, `[458,542]`, `[440,560]`, `[420,580]`, `[400,600]` | identical; shares become `[487,511]`, `[473,525]`, `[457,541]`, `[439,559]`, `[419,579]`, `[399,599]` | 0px |
| Add a third child to 1000px `[500,500]` | `[334,334,332]` | `[1,1,1]` projects `[333,333,334]` | `-1,-1,+2`px portable minus COSMIC |
| Add to 798px `[389,409]` | `[259,273,266]` | `[389,409,399]` projects `[259,272,267]` | `0,-1,+1`px |
| Add then remove that inserted child from the first case | `[500,500]` | `[500,500]` | no cycle drift |
| 101px three-way: source stored `[34,33,34]`, portable equal shares | `[34,33,34]` | `[1,1,1]` projects `[33,33,35]` | `-1,0,+1`px |
| Nest the final child of that row with source `[12,11,11]` and portable equal shares | final nested leaf is `x=90,w=11` | final nested leaf is `x=88,w=13` | `x=-2,w=+2`px |

- The supported binary keyboard path is source-equivalent in this calculation:
  `pixel_shares_for_clamped` solves for the exact projected left boundary, and
  the right child receives the remaining pixels (`src/session.rs:5703-5797,
  5812-5947`). Repeating it does not introduce a rounding walk.
- For N-ary admission/removal, differences are visible at one or two pixels in
  ordinary three-child examples. At a fixed group/extent they are bounded by
  integer allocation, not an unbounded session drift: the engine retains shares,
  not a re-quantized observed rectangle. The residual can grow with sibling
  count because COSMIC rounds every survivor before assigning its residual, so
  this record does not claim a universal two-pixel bound.
- Nesting can add placement error along a same-axis path, as the final row shows:
  an ancestor's one-pixel boundary shift changes the child extent that its
  descendant divides. That is a structural rounding difference, not time-based
  accumulation. No source or current test establishes it as user-visible at
  normal nesting depths.
- Recommendation: **leave it**. The demonstrated difference is small, the main
  repeated keyboard path is exact, and no jitter or user-visible accumulating
  error is grounded. Reopen only after a reproduced visual discrepancy in an
  N-ary/deep layout or a required source-exact fixture that fails under shares.

### Q2(b): Cost Of Deferral

- This is not a projector-only swap. Shares are topology authority in
  `src/geometry.rs`, `src/directional.rs`, `src/session.rs`, and
  `src/cosmic_v1.rs`; resize operations carry `old_shares/new_shares` through
  `src/contract.rs:873-899` and reconciliation validators; service payloads,
  resize fixtures, trace locks, and adapter contracts encode them.
- A future pixel authority needs stored per-group geometry/sizes and source-style
  rescaling, then changes to admission/removal, keyboard and pointer derivation,
  operation validation, serialized contract/fixtures, and the adapter boundary.
  It is a medium cross-cutting migration now or later, not a small isolated
  projector patch. Deferral does not make the existing representation unsafe,
  but later public fixtures/routes increase conversion and compatibility work.

### Q2(c): Windows That Refuse Geometry

- Current behavior has no share-to-pixel feedback loop. The adapter reobserves
  after each write and requires exact desired rectangles; any refusal or altered
  native size reports loss, disables the route, and never commits the new share
  state (`kwin/src/resize-adapter.ts:1692-1736,1906-2013`). The Rust reconciler
  likewise requires acknowledged, verified operation equality and terminally
  diverges on mismatch (`src/reconcile.rs:1180-1264`). This prevents bounce by
  failing closed; it does not damp or absorb a client-selected size.
- Replacing shares with pixels alone would not improve that behavior. Absorbing a
  client's actual size requires an explicit reconciliation policy that also
  redistributes siblings and resolves minimum/maximum constraints. Without it,
  a pixel authority would reject the same mismatch.
- COSMIC mutates its stored group sizes before relayout. Its resize paths defer
  tree/configure progress while mapped surfaces have not committed their latest
  size; they do not ingest an arbitrary client-reported rectangle into `sizes`.
  See [`resize`](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs#L2514-L2616)
  and [`pointer resize`](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/grabs/resize.rs#L270-L332).
  Therefore source evidence does not support a claim that pixel authority alone
  eliminates resize refusal or jitter.

## Limits

- No live KWin/Plasma behavior, native pager/overview behavior, hotplug order,
  or client resize refusal was tested.
- The exact audited COSMIC lifecycle after `new_group` leaves an odd pixel
  unassigned was not fully traced; see
  `docs/changes/archive/cosmic-geometry-parity.md:52-56`.
- The geometry calculations are direct arithmetic over cited source formulas,
  not a live compositor measurement.

## Outcome

- Keep both questions open pending user decision.
- Recommendation: choose a project-owned Plasma workspace mechanism; leave the
  share model unless the stated source-exact or visual trigger occurs.
