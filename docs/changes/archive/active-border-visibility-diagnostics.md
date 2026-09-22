# Active Border Visibility Diagnostics

## Goal

- Make a future active-border disappearance diagnosable from bounded native
  transition logs without changing display behavior.

## Scope

- Record endpoint availability once, initial-gate apply results, and active
  border visibility on its first evaluation and subsequent visibility changes.
- Use fixed reason tokens only; never log window identity, epochs, payloads,
  geometry, output, or workspace data.

## Evidence

- The supplied trace records script `initial-maximize` submissions and clears,
  but no native active-border endpoint, gate, or visibility events. It cannot
  distinguish expected suppression from a stuck native gate or render state.
- Native logs now emit endpoint availability once, initial-gate apply code plus
  confirmation state, and the first or changed active-border visibility with a
  fixed suppression reason. Logging is best-effort and cannot change rendering.
- `initial-apply code` is `1` accepted, `2` stale/out-of-order preserved, `0`
  parse-rejected and cleared, `3` focus-mismatched and cleared, or `-1` usage
  error. A `visible` record reports renderer eligibility only, not pixels drawn.
- `npm run typecheck && npm test` passes (883 tests), and `just
  build-native-effect` compiles the host-matched effect and KCM. A separate
  host-derived `BUILD_TESTING=ON` CMake build passes all 27 native CTests.
