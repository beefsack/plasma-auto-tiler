# Window Gap Configurability

## Goal

- Replace the fixed effective `(inner, outer) = (8, 8)` domain gaps with native
  KCM-owned, bounded script settings while preserving that default.

## Scope

- `innerGap` and `outerGap` are integer settings in the existing empty script
  group, bounded 0 through 64 and defaulting to 8.
- KWin validates each startup `readConfig` value and falls back to 8 for absent,
  malformed, or out-of-range values.
- Every production plan, resize, pointer-resize, and workspace-send observation
  or request uses the same startup-resolved pair. Rust continues to validate and
  project the supplied values.

## Boundary

- KCM Apply persists the settings only. The running script has no configuration
  watcher, so it neither changes retained topology nor applies new gaps in
  flight. A user session restart remains required before relying on changed gaps.
- No live KWin, Plasma, Qt, or D-Bus operation is part of this change.

## Verification

- Offline schema, KCM, config-validation, and production payload coverage.
- KWin TypeScript build, typecheck, and test suite.

## Outcome

- Delivered `innerGap` and `outerGap` through the existing native KCM and KWin
  script configuration group. The default remains `(8, 8)` and both controls
  reject values outside 0 through 64.
- The startup binding is used by plan, resize, pointer-resize, and workspace-send
  paths. Rust remains unchanged and continues to reject retained domain gap
  mismatches rather than mutate topology.
- Offline verification passed: `npm run typecheck`, `npm run build`, `npm test`
  (682 passing), and `cargo test --offline`.
