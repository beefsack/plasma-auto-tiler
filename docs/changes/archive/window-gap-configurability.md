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
- Native offline verification passed in a fresh `BUILD_TESTING=ON` CMake build:
  the QWidget KCM plugin compiled and its generated UI included both gap
  spinboxes. `native-effect-kcm-config-gaps` passed under the existing poisoned
  session-bus, temporary-config, offscreen harness. It verifies malformed and
  out-of-range values normalize to 8, 0 and 64 round-trip through KConfig,
  missing values remain unset until changed, and defaults persist 8 for both
  settings.
- The KCM states that only border changes apply immediately; other script
  settings require a script reload or session restart. Gap changes have no
  hot-apply claim.

## Moved Evidence (from docs/decisions.md)

- Implementation is partial: only gap reload is static-complete with retained
  offline proof and live verification pending. The implemented gap resync
  dispatches retained `update-gaps`, accepted and reprojected by the existing
  session with topology/share/focus preservation for changed inner, outer, or
  combined gaps. Overall settings liveness is PARTIAL, not complete.
