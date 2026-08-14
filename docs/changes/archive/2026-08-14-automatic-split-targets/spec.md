# Automatic Split Targets

## Intent

Allow users to choose which occupied leaf receives an automatically tiled new
window, without changing the selected split orientation.

## Scope

- Add the `automaticSplitTarget` enum setting with `dwindle` as its default.
- Supported values are `dwindle`, `largest`, and `active`.
- Select the intended occupied leaf before the existing automatic split is
  applied.
- Use existing stable `compareLeaves` ordering for all specified tie-breaking
  and fallback behavior.

## Behavior

- `dwindle` preserves the current automatic split intent.
- `largest` selects the occupied leaf with the greatest area. Equal areas use
  the earlier `compareLeaves` ordinal.
- `active` selects the active occupied leaf when it is available, eligible, and
  in scope. Otherwise it uses the `dwindle` intent.
- If an intended leaf cannot be split, use the eligible leaf nearest by stable
  `compareLeaves` ordinal. Equal-distance candidates use the earlier ordinal.
- If no eligible target exists, leave the newcomer floating and do not mutate
  topology.
- The chosen leaf is the only changed target; split orientation is unchanged.

## Configuration Compatibility

- Missing, empty, or invalid `automaticSplitTarget` settings resolve to
  `dwindle`.
- An invalid non-empty value emits the established invalid-setting diagnostic.
- Missing and empty values do not emit that diagnostic.
- Existing defaults and unrelated settings behavior remain unchanged.

## Non-Goals

- Ancestor resizing.
- Hot apply behavior.
- Drag behavior.
- Keyboard behavior.
- New split orientations.

## Acceptance Criteria

1. The settings schema and KCM expose the three-value enum, defaulting to
   `dwindle`.
2. Startup configuration parsing deterministically normalizes missing, empty,
   and invalid values to `dwindle`, diagnosing only invalid non-empty input.
3. Pure selection honors `dwindle`, `largest`, and `active`, preserving
   orientation and all specified eligibility, fallback, and tie rules.
4. Controller integration applies the chosen target only to automatic tiling;
   no target leaves the newcomer floating without topology mutation.
5. Focused parser, selection, controller, schema/UI static checks, and
   typecheck evidence cover the implemented behavior.

## Decisions

- User-approved semantics supplied at checkpoint 1 are the source of truth.
- The earlier over-cap prior survey is rejected as process evidence and is not
  used to justify implementation decisions.

## Open Questions

- None.
