# COSMIC Geometry Parity

## Goal

Settle COSMIC outer-gap evidence and precisely identify the remaining integer
projection rounding gap without inventing a pixel-size representation for the
portable N-ary tree.

## Scope

- Establish the COSMIC default gap values and effective leaf-edge geometry.
- Lock the equivalent portable 8px inner and effective outer margins with an
  explicit nested fixture.
- Record the source N-ary pixel-size and rounding behavior, its exact delta from the
  portable share projector, and why it remains open.

## Non-goals

- User-configurable gaps, KCM changes, live KWin work, and cross-boundary
  refactoring.
- Replacing ordered N-ary `u64` shares with source-style N-ary `i32` pixel
  sizes.

## Source Evidence

- `cosmic-comp` `81cd5fdbaa41c3973369ae85bccf829137836e20`,
  [`TilingLayout::gaps`](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs#L4305-L4308)
  reads `(outer, inner)` from the active theme. The Cargo lock pins libcosmic
  `d922ac380134c00208d2acf93947d44fb217eec5`; its
  [`ThemeBuilder::default`](https://github.com/pop-os/libcosmic/blob/d922ac380134c00208d2acf93947d44fb217eec5/cosmic-theme/src/model/theme.rs#L933-L934)
  defaults to `(0, 8)` and the
  [`Theme::gaps` documentation](https://github.com/pop-os/libcosmic/blob/d922ac380134c00208d2acf93947d44fb217eec5/cosmic-theme/src/model/theme.rs#L103-L104)
  fixes that order. Theme derives `CosmicConfigEntry`, so it is source-level
  configurable; this project deliberately remains hardcoded.
- [`update_positions`](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs#L3006-L3011)
  applies raw outer once per edge (`loc += outer`, `size -= 2 * outer`). Its
  mapped-leaf edge insets at
  [`3055-3087`](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs#L3055-L3087)
  apply `inner / 2` toward an adjacent node and full `inner` toward an
  unadjacent edge. Therefore the default rendered work-area margin is
  `outer + inner = 8`, while each adjacent pair has an 8px gap.
- [`Data::Group`](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs#L150-L154)
  stores N-ary `Vec<i32>` pixel sizes. Add rounds scaled survivors and assigns
  its residual to the inserted child; remove and update rescale with `.round()`
  and correct the final child
  ([219-240](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs#L219-L240),
  [255-278](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs#L255-L278),
  [292-320](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs#L292-L320)).
  Layout uses reverse iteration and exact running integer offsets
  ([3098-3117](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs#L3098-L3117)),
  not layout-time rounding.
- [`new_group` (177-191)](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs#L177-L191)
  initializes both binary children with truncated integer `axis_length / 2`.
  The audited function does not assign its odd-pixel remainder; whether a later
  geometry update necessarily repairs that state before every paint was not
  fully traced, so this record makes no claim about that lifecycle.

## Plan

1. Add a source-derived nested default-gap geometry fixture.
2. Record the settled outer-gap result and the blocked share/rounding delta.
3. Run focused Rust and TypeScript static tests, then archive this record.

## Acceptance

- The fixture proves the portable effective 8px work-area edge margin and inner
  spacing for a nested split, including no doubled outer inset.
- The records distinguish raw COSMIC theme outer gap from the adapter's
  effective visual inset.
- The unadapted source N-ary pixel-size rounding behavior is explicit rather than
  claimed as parity.

## Outcome And Evidence

- Settled outer-gap result: no engine value changed. COSMIC's raw default outer
  theme value is 0, but its full inner inset on unadjacent leaf edges makes the
  rendered work-area edge margin 8px. The portable `DOMAIN_GAP = 8` and
  `OUTER_DOMAIN_GAP = 8` therefore match default inner spacing and work-area
  edge margin; the latter is an effective visual inset, not COSMIC's raw theme
  outer value. Rust applies it once per edge by subtracting 16px per axis,
  matching the source outer-edge result after source leaf-edge adjustment.
- Durable fixture: `geometry::tests::cosmic_default_nested_h_a_v_b_c_matches_effective_outer_8`
  asserts default `H[A,V[B,C]]` geometry in a `100x100` work area: `A`
  `(8,8,38,84)`, `B` `(54,8,38,38)`, `C` `(54,54,38,38)`. It locks the
  effective outer margin, two sibling gaps, nested projection, and no doubled
  outer inset.
- Open share/rounding result: COSMIC retains N-ary `Vec<i32>` pixel extents,
  rounds rescaling at mutation time, assigns add residual to the inserted child,
  corrects remove/update residual to the final child, then lays out exact
  running offsets. New binary groups use truncated halves without a local odd
  remainder correction. The portable ordered N-ary `Vec<u64>` share model instead
  reserves one pixel per child, floors each non-final proportional allocation,
  and gives remaining pixels to the final child at projection time. It cannot
  faithfully reproduce source mutation-time rounding without a new pixel-size
  authority carried through topology, resize, and reconciliation. No
  source-grounded low-risk adaptation fits this change budget, so this gap
  remains open and no false rounding fixture or parity claim is shipped.
- Static verification: `cargo test --lib geometry`, focused geometry test,
  `npm run typecheck`, and bundled `plan-adapter` tests passed. These prove the
  deterministic portable geometry contract and request carry only; a
  user-owned live KWin run is still required to prove native sequential geometry
  application and visual behavior.

## Next Action

- None for outer-gap parity. A separate scoped change must introduce and test a
  source-faithful N-ary pixel-size representation before closing share/rounding
  parity.
