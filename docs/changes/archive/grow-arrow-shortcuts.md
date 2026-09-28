# Grow Arrow Shortcuts

## Goal

Give every HJKL directional action an arrow-key alias, including grow (resize outwards), and retire the unused insert-arrow reservation.

## Scope And Acceptance

- Register Meta+Alt+Left/Down/Up/Right for grow, matching the existing shrink-arrow pattern; remove obsolete insert entries from catalog documentation and acceptance fixtures.
- Plasma 6.7.5 defaults occupy those chords. Clear the four stock `Switch Window` bindings through the existing reversible KCM reconciler, as decided by the Orchestrator on 2026-09-28; no relocation.
- Record the user's 2026-09-28 rule in decisions.md; update the live override checklist if reconciled chords change.
- Do not mutate live shortcuts or touch the user's devenv.nix or Orchestrator-owned backlog.

## Units And Verification

1. Inspect default bindings and conditional native/KCM behavior.
2. Update script catalog, README, shell fixtures and focused tests.
3. Integrate and verify KWin npm test/typecheck, affected shell tests, conditional native build/CTest, and git diff --check.

## Outcome And Evidence

Catalog, README, fixtures, tests, dev-loop text, decisions.md, native KCM
reconciler and live verification instructions are updated. KWin npm test:
798/798 (baseline 797); typecheck passed; affected shell tests: 131/131 and
237/237; native build and CTest: 29/29; diff --check clean. No live shortcut
mutation or physical shortcut verification.

[KWin v6.7.5 `src/useractions.cpp:895-902`](https://github.com/KDE/kwin/blob/v6.7.5/src/useractions.cpp#L895-L902)
defaults all four Meta+Alt+Arrow chords to `kwin/Switch Window <Direction>`.
The 2026-09-28 Orchestrator decision under the 2026-09-21 standing approval
authorizes clearing the four `Switch Window` defaults with Apply/Force/Revert,
without relocation. Follow the updated live override checklist for user-run
physical Apply/Force/Revert and grow-arrow verification.
