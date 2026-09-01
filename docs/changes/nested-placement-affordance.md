# Nested Placement Affordance

## Goal

Replace the temporary outline interaction with a minimal COSMIC-like,
deterministic affordance for nested split placement.

## Scope And Non-Goals

- Show a generic target-leaf placement affordance and infer the split direction
  on release.
- Direction-axis insertion may flatten same-axis siblings; differing-axis
  insertion may build a two-child nested split.
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

- Accepted audit evidence covers generic target-leaf preview, release direction
  inference, same-axis flattening, and differing-axis nested insertion.
- The current status is pending static implementation evidence; the required
  teardown and independently active drag-outline preservation behavior is not
  claimed complete.
- Runtime interaction and live visual acceptance remain unrun.

## Material Decisions And Accepted Evidence

- The MVP selects the smallest COSMIC-like deterministic nested-placement UI;
  it does not claim darkening or opacity behavior.
