# Scope Bootstrap Shape Diagnostics

## Goal

Make the startup exact-three scope diagnostic identify which required
orientation prevents adoption.

## Scope

- Replace the conflated `reason=shape` category with closed, bounded tokens
  for a non-wide sorted middle window and a non-tall sorted last window.
- Preserve every adoption and skip decision, including the exact-three gate.
- Regenerate the KWin bundle without reloading the live script.

## Non-Goals

- Change the Rust seed, window eligibility, scope observation, focus behavior,
  geometry, or the three-window product limitation.

## Acceptance

- Each orientation predicate emits its own bounded `reason` token.
- Focused tests prove the two tokens are distinct and no bootstrap side effect
  occurs for either refusal.
- KWin typecheck, test suite, and start-test harness are run under the stated
  known-failure constraints.

## Approach

- Keep `trioBootstrapTarget()` as the adoption authority and make its
  diagnostic classifier report the two existing orientation checks separately.

## Outcome

- `reason=shape` conflated the `B.width > B.height` and
  `C.width <= C.height` checks after lexical internal-ID sorting. It now emits
  `middle-not-wide` or `last-not-tall`; malformed internal member access
  remains the existing `unknown` category.
- No adoption, eligibility, or three-window behavior changed. A skipped
  bootstrap sends no Planner request and leaves the shared revision unseeded.
  A later focus request is independently dispatched, but the Planner rejects
  it as `unseeded-trio` because focus carries no geometry with which to seed.
- The user needs exactly three eligible normal, managed, resizeable windows on
  the active output and current desktop, each solely on that desktop,
  unminimized, non-fullscreen, unmaximized, non-sticky, and contained in the
  work area. In lexical internal-ID order, the second must be wider than tall
  and the third must be taller than or equal to wide. Position itself is not
  validated; those orientation inputs produce `H[A,V[B,C]]`.

## Evidence

- `kwin/tests/resize-entry-bootstrap.test.ts`: focused suite passes 7/7,
  including distinct token assertions for both orientation failures.
- `bash scripts/start-test.test.sh`: 399 passed, 0 failed.
- `npm --prefix kwin run typecheck`: expected unrelated unused
  `catalogValidationDiagnostics` error in `kwin/src/controller.ts`.
- `npm --prefix kwin test`: affected bootstrap suite passes; 11 unrelated
  failures come from protected untracked COSMIC/POC residue tests.
- Regenerated `kwin/contents/code/main.js` with the current live nonce and
  build identity. No KWin reload, shortcut, Planner action, or live tiling
  action was performed.
