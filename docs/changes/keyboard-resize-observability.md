# Keyboard Resize Observability

## Goal

- Make failed resize shortcut registration and COSMIC pair-minimum refusal
  visible without changing COSMIC resize policy.

## Scope

- Log one bounded `shortcut-failed` line for every false or throwing KWin
  shortcut registration, naming the project action and requested chord.
- Return `pair-below-minimum` instead of generic `unchanged` when a keyboard
  resize cannot plan through a COSMIC 720px/480px pair threshold.
- Keep the threshold values, keyboard policy, retained Session trees, and all
  other no-change outcomes unchanged.

## Static Evidence

- Focused KWin TypeScript tests cover a false registration result and continued
  registration of all 24 actions.
- Focused Rust resize tests cover direct pair sums below 720px/480px and retain
  `unchanged` for a boundary with no neighbor.
- `npm run typecheck`, focused KWin tests, and focused Rust resize tests pass.

## Live Boundary

- The KWin entry change requires a full controller reload before a user-run
  physical-key capture can report its registration diagnostics.
- No live KWin/Plasma action occurred in this change. Phase 2 awaits that
  capture; it must not infer a COSMIC policy change from static evidence.
