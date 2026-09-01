# Nested Placement Affordance

## Goal

Replace the temporary outline interaction with a minimal COSMIC-like,
deterministic affordance for nested split placement.

## Scope And Non-Goals

- Show a generic target-leaf placement affordance and infer the split direction
  on release. The rectangle preview is deliberately bounded to the whole target
  leaf; it does not preview a directional sub-rectangle.
- Direction-axis insertion may flatten same-axis siblings; differing-axis
  insertion may build a two-child nested split. Grouping here means nested split
  placement, not tabs, stacked/shared groups, or compositor groups.
- This is not opacity or dimming, and it does not add tabs, stacked/shared
  groups, or compositor group behavior.

## Acceptance

- The affordance deterministically previews the target leaf and resulting
  nested placement without conflicting with drag outline ownership.
- Release produces the selected nested split structure, including distinct
  structures such as `H[H[1 2] 3]` and `H[1 H[2 3]]`.
- The MVP implementation must deterministically tear down the replaced
  temporary group/placement outline on every release, cancel, and timeout,
  without hiding, clearing, or otherwise corrupting an independently active
  drag outline.
- Completion and acceptance require source evidence for that teardown and
  drag-outline preservation behavior.
- Existing arbitrary-arity split trees remain preserved while respecting the
  current same-axis flattening and differing-axis nesting semantics.
- Pointer and live KWin acceptance are separately authorized; no live result is
  claimed until manually verified.

## Approach And Dependencies

- Depend on stable Custom Tile tree reconstruction and the COSMIC movement
  semantics.
- Preserve the existing drag lifecycle boundary while replacing the temporary
  outline-only interaction.

## Verification

- Static MVP completion is accepted. Available source and focused fixture
  evidence is:
  - `kwin/src/controller-interactive-drag.ts` bounds preview to the target leaf,
    infers release direction, reads post-split children, and preserves the
    deferred origin-collapse boundary.
  - `kwin/tests/controller-interactive-drag.test.ts` covers direction mapping,
    live post-split child decoding, central-zone direction selection, empty-leaf
    placement, and same-axis wrapping into a new direct sibling.
  - `kwin/tests/controller-interactive-drag-outline.test.ts` covers whole-leaf
  preview without mutation, preview invalidation and replanning, minimum-size
    refusal, cleanup on release and invalidation/terminal paths, and differing-axis nested
    placement with deferred origin collapse.
  - `kwin/src/controller.ts` and `kwin/tests/controller-group-outline.test.ts`
    cover replacement outline teardown and preservation of an independently
    active group flash.
- No live KWin interaction or manual visual acceptance is claimed. The residual
  gate is one user-performed manual visual smoke of the bounded preview and
  nested split placement; it is the next MVP action, not stale-harness recovery.

## Material Decisions And Accepted Evidence

- The MVP selects the smallest COSMIC-like deterministic nested-placement UI;
  it does not claim darkening or opacity behavior.
