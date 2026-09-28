# Shortcut Table Refactor And Arrow Collisions

## Goal

Drive native shortcut reconciliation from one conflict table, then claim six more arrow chords whose Plasma defaults conflict with project focus/move actions.

## Scope And Acceptance

- Refactor table-driven lookup, validation, write, clear/relocate, verification, status, and key enumeration without altering Apply/Force/Revert semantics, call order, bounds, or durable cleared IDs. Derive the write cap from table size; reach a green build/CTest point before new rows.
- Add clear-only rows for four Quick Tile Meta+Arrows and two screen-switch Meta+Shift+Left/Right defaults; verify upstream action IDs. Update KCM text, shortcut decisions, and live verification instructions.
- No live shortcut/KWin mutation, git mutation, or edits to devenv.nix/backlog.md.

## Units And Verification

1. Refactor native table consumers and KCM status; verify native build/CTest and record net production/test lines.
2. Add six rows with native tests and docs; verify native build/CTest, KWin npm test/typecheck, affected shell tests, diff --check, and net lines for the rows alone.

## Outcome And Evidence

At the nine-row green point, the refactor passed native build/CTest 29/29.
Refactor-only production: +253/-285 (net -32); tests: +0/-8 (net -8).
Preserved lookup/error order, D-Bus order, Lock Session relocation,
Apply/Force/Revert behavior, and persisted cleared-ID semantics.

KWin v6.7.5 [`src/useractions.cpp:879-886,949-952`](https://github.com/KDE/kwin/blob/v6.7.5/src/useractions.cpp)
defines the six Quick Tile/previous-next screen defaults. Six table clear rows
now supersede them, with the user's 2026-09-28 decision in decisions.md.
Six-row unit plus table-driven KCM text: production net +71, tests net +256
relative to the green refactor; total native production net +39, tests net
+248 relative to 1115cca. README and live override checklist updated.

Final checks: `just build-native-effect`, native CTest 29/29, KWin npm test
798/798 and typecheck, affected shell tests 131/131 and 237/237, and
`git diff --check` passed. No live shortcut/KWin mutation or physical checks.
