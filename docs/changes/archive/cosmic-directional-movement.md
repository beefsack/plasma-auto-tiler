# COSMIC N-ary Tiling And Directional Movement

## Goal

Deliver the largest safe, source-evidenced COSMIC-style N-ary Custom Tile
adapter for the MVP, replacing geometry-based directional selection with no
legacy fallback.

## Scope And Non-Goals

- Ordered N-ary Custom Tile decoding, tree-relative focus, safe directional
  movement, proportional lifecycle sizing, keyboard resize, and output-edge
  routing are in scope.
- Tabs, stacks, shared tiles, compositor groups, and the nested-placement UI
  replacement are excluded. KWin empty leaves are an explicit adaptation.

## Acceptance

- Production preserves ordered N-ary split-tree topology where KWin exposes it,
  performs source-proportional removal sizing and half-half new splits, and
  rejects malformed, stale, unsupported, or ambiguous topology before mutation.
- Focus and parallel swaps are production-coupled; safe KWin-unrepresentable
  structural moves and output transfer are named fail-closed gaps.
- Type, focused, broad, build, and diff checks pass. Live acceptance remains
  separately authorized.

## Direct Evidence

- Authority is `pop-os/cosmic-comp` commit
  [`f8344126`](https://github.com/pop-os/cosmic-comp/tree/f8344126a16e7f8712fa123076fc34c9238493a7).
  Its [`tiling implementation`](https://github.com/pop-os/cosmic-comp/blob/f8344126a16e7f8712fa123076fc34c9238493a7/src/shell/layout/tiling/mod.rs)
  establishes ordered N-ary `sizes: Vec<i32>`, proportional `add_window` and
  `remove_window`, half-half `new_group`, tree-relative `next_focus`, and
  `move_current_node`; [`actions.rs`](https://github.com/pop-os/cosmic-comp/blob/f8344126a16e7f8712fa123076fc34c9238493a7/src/input/actions.rs)
  establishes workspace/output edge fallback.
- Upstream has no tiling conformance tests. The project corpus and retained
  runtime material are supporting evidence only, not upstream proof.
- Pixel rounding, animation, pointer-grab detail, geometry tie-breaks for
  perpendicular focus descent, exact output selection, and cross-workspace
  routing were not authoritatively established in this change.

## Outcome And Evidence

- Production decodes ordered N-ary Custom Tile trees by split-axis geometry,
  rejects invalid directions, nonreciprocal/cyclic/shared topology and
  multi-window leaves, and retains empty leaves only as the named KWin
  adaptation. Focus climbs/descends the tree; exhausted same-desktop output
  edges select only eligible windows. Parallel movement swaps or assigns an
  empty adjacent leaf without geometry neighbor fallback. R1 is implemented
  with checked half-half split geometry and exact-once postcondition checks.
- Automatic insertion makes checked half-half splits and removal redistributes
  proven N-ary sibling shares proportionally. Keyboard resize uses the existing
  KWin-relative 0.15 floor and 0.05 step, now fail-closed on unreadable areas
  or parent cycles.
- R2b/R2c occupied/R3 structural reparent or insert-child moves and R4
  cross-output window transfer are deliberately rejected before mutation: the
  public KWin adapter surface used here lacks a proven safe primitive. This is
  bounded parity, not a claim of full COSMIC movement parity.
- Independent adversarial review found orphaning/partial-mutation hazards,
  dead removal sizing, binary insertion, weak edge tests, topology gaps, and
  resize fail-open paths. The corrective unit eliminated or fail-closed them.
- `npm run typecheck`, focused 125-test verification, and `npm test` passed:
  1,066 Node tests and 384 start-script checks. `git diff --check` passed.
  No live KWin/Plasma mutation or result is claimed.

## Material Decisions And Accepted Evidence

- COSMIC-style tiling movement is MVP. Grouping means nested split-tree
  structure and placement; `H[H[1 2] 3]` differs from `H[1 H[2 3]]`.
- The user selected the N-ary Custom Tile architecture. Direct upstream source
  overrides conflicting project corpus inference, including no-resize removal
  claims. Static outcome is accepted only at the bounded scope above; live
  acceptance is pending.
