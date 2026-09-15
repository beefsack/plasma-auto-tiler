# Active Group Highlight Held Refresh

## Goal

- Keep a valid immediate-group outline current while Meta is held when retained
  focus changes or a completed geometry plan changes its group geometry.

## Scope

- Align retained focus from a valid active-group observation before resolving
  the retained tree.
- Refresh once after completed admit, move, remove, or keyboard-resize plans.
- Make the script diagnostic describe setter submission rather than effect
  acceptance or rendering.

## Non-Goals

- No timed flash, polling, retry, geometry subscription, native C++ change, or
  live KWin/session operation.

## Acceptance

- A real Planner lifecycle test builds `H[W1,V[W2,W3]]`, changes focus, moves
  within the nested group, and resolves the immediate active group both times.
- The KWin bridge refreshes once after a qualifying completed geometry plan and
  never on rejected or stale replies.
- The setter diagnostic makes no effect-delivery or visibility claim.

## Outcome

- Implemented and statically verified. `cargo test --lib
  planner_protocol::tests::retained_active_group` passed 4 tests, `cargo test
  --lib active_group` passed 8 tests, the focused KWin bridge tests passed 96
  tests, and `npm --prefix kwin run typecheck` passed. The native effect was
  unchanged.
