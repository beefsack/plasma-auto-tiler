# Dwindle Insertion Preflight

## Intent

Refuse tiled-window splits that violate KWin minimum geometry before structural
mutation. Automatic insertion must use a valid dwindle fallback when one exists
and otherwise leave only the new window floating.

## Scope

- Preserve a refused drag's exact source tile and geometry.
- Preflight the current dwindle-intended leaf before splitting it.
- When it is ineligible, choose the eligible leaf with the smallest absolute
  position difference in stable `compareLeaves` order.
- Resolve equal distances by the earlier `compareLeaves` leaf: `y`, then `x`,
  then `id`.
- Leave the new window floating without changing tiled topology or marking a
  scope inert when no eligible leaf exists.

## Non-Goals

- Configuration.
- Floor-aware ancestor resizing.
- Keyboard insertion behavior.
- Reconstruction or inert-policy changes.

## Constraints

- Preserve homogeneous structural batches, fresh root decoding after every
  structural call, no fixed timer barrier, and the prescribed reconstruction
  path.
- Never use post-mutation inert recovery for a refused split.
- Preserve the existing behavior when work-area geometry cannot be read: do not
  invent a minimum floor.
- Generated `kwin/contents/code/main.js` is build output only and is never
  hand-edited.

## Acceptance Criteria

1. An undersized drag split causes no structural mutation and preserves the
   dragged window's exact source tile and geometry.
2. Automatic insertion tests the current dwindle-intended leaf before any
   split.
3. If that leaf is ineligible, automatic insertion selects the closest eligible
   leaf in stable traversal order, with the earlier leaf winning an equal
   distance tie.
4. If no eligible leaf exists, only the new window remains floating; tiled
   topology has no gap and no inert scope.
5. Invalid automatic insertion does not rely on a failed split followed by
   reconstruction recovery.
6. Existing unreadable-work-area behavior is unchanged.
