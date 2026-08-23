# Log: Controller Source Split

Append-only record of artifact creation and approved execution checkpoints.

## 2026-08-23 - artifact creation

- Role / unit: Worker / planning artifacts / unit 01 not started.
- Result: created the approved Expanded `spec.md`, `plan.md`, `log.md`, and
  `state.md`; updated the active controller-split backlog entry with the change
  link and downstream COSMIC directional-move dependency wording.
- Files / commit: `docs/changes/controller-source-split/{spec.md,plan.md,log.md,state.md}`
  and `docs/backlog.md`; no commit.
- Verification: no production source, tests, generated bundle, dependencies, or
  live KWin state changed. No live KWin operations occurred.
- Notes / blocker: none.

## 2026-08-23 - unit 01 acceptance

- Role / unit: Lead / unit 01 - config and catalog.
- Result: extracted configuration interpretation, profile/catalog ownership,
  and pure automatic-target contracts to `kwin/src/controller-config.ts`.
  `controller.ts` remains the sole public facade and composition root, retaining
  its public exports through a direct re-export. Session/output state and
  shortcut registration callbacks remain in the controller.
- Review: corrected one same-scope drift so `TILING_ALGORITHMS` retains its
  direct `PRESET_KINDS` ownership rather than a copied catalog. Static import
  review found `controller-config.ts` depends only on `logic` and
  `preset-catalog`; no controller import, extracted-domain import, or cycle.
  The module is 536 lines. Static inspection retained one production
  `flashFocusedGroup()` invocation and did not alter structural mutation/flush.
- Verification: focused config/catalog tests 167 tests / 19 suites / 0 failures;
  both TypeScript configurations clean; full JS suite 965 tests / 91 suites /
  0 failures. Two normal bundle builds produced SHA-256
  `1fe1e11a959004a1d8a2636cf4148776b864257fbfe0d018efaa4faccc1e6ad3`.
  `npm test` also reported its current script-local check as 255 passes / 0
  failures; Unit 01 has no dogfood checkpoint gate. No live KWin operations.
- Notes / blocker: none. Circuit breakers remain 0.
