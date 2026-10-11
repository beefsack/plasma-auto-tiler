# Workspace send follow/stay and scoped relative targets

## Goal and scope

- Deliver consensus item 2 (R-WS-01/14, R-WS-18..20), decisions 2.1/2.2 and the existing floating-boundary follow default.
- Shared Rust send intent and protocol, KDE adapter and native catalog/presets; reuse item 1's scoped ordinal ring.
- Windows edits limited to decision 2.3's compile-only fix preserving always-follow behavior; real adapter wiring remains in the backlog (D1). No live KWin tests, dependency installs or commits.

## Acceptance and approach

- Follow remains the default; stay preserves source selection and uses source focused-removal MRU, with unchanged destination admission.
- Relative targets resolve once, wrap both ends, include trailing empty and ordinals beyond 9; existing lifecycle supplies the next spare.
- Numbered follow bindings stay intact; relative follow uses Ctrl+Shift arrows/HJKL; numbered and relative stay register unbound and remain rebindable.
- Authentic clears stock Window One Desktop arrow holders; Compatible disables our arrow forms, keeping letters.
- Floating boundaries remain membership-only with tiled-side reflow and explicit follow/stay.
- Sequential bounded Workers: Rust contract/tests; KDE routing/tests; native catalog/presets/tests; Lead reviews, reconciles records, verifies offline checks and stages exact paths.

## Review and evidence

- Initial worktree clean. Rust uses an explicit `follow: bool`, wire omission defaults true; this is representation of the recorded pair, not a new behavior.
- Lead rejected a stay implementation that only validated source focus without applying it; corrected to bind and apply the core MRU survivor after fresh arrival, with no desktop switch. Null focus follows existing adapter no-setter convention.
- Initial native verification failed because default-empty rows were interpreted as disabled and as key zero. One narrowly causal repair teaches both KCM load paths and post-state checks that canonical key zero means unbound. Bound-row semantics retained; native checks subsequently pass 33/33.
- Lead review additionally caught pinned-source identity being mistaken for
  current source visibility. Both native observation producers now supply the
  actual current workspace; stay fails closed on switched/unreadable source
  before writes and before MRU/null-focus confirmation. Regression fixtures
  cover target/third-workspace switches during the flight.
- Floating follow freezes its recording output before membership setters and
  re-proves mover arrival before both switch and focus. Shared mode follows on
  every connected output; floating geometry remains untouched.
- Independent Worker reviewed the shared contract, flight fences, scoped ring,
  catalog and Windows sites. Lead accepted the review after inspecting actual
  diffs and correcting the visibility gap. Explicit workspace-send plan
  construction now requires matching move intent; no default-intent shim.
- Shared core stay and focused removal use the same source MRU fallback;
  follow/stay tests prove identical destination topology/geometry/operation.
  Ordinary external observation still prefers valid observed native focus;
  membership-only floating boundaries retain that existing native-focus
  policy, rather than inventing new floating MRU tracking.
- USER decision 2.3 (2026-10-07) permits compile-only Windows fixes for items
  2-5 preserving current behavior. `workspace_owner.rs` constructor and test
  pattern now use `follow: true`; no Windows behavior/input/native wiring changed.

## Outcome and verification (2026-10-07, offline)

- Delivered R-WS-01/14 and item-2 discriminator rows R-WS-18..20. Eight new Rust
  tests plus stricter constructor coverage; 33 new KDE tests (936 -> 969).
  The scoped relative ring, wrap and spare creation are adapter-owned, so Rust
  receives the once-resolved absolute target plus explicit follow/stay.
- Native/TypeScript parity: 111 bindings (36 plan + 75 workspace), including
  8 bound relative follow and 28 unbound numbered/relative stay rows; 23
  compiled conflicts. Hermetic tests prove default-empty rows remain Keep and
  rebindable, Authentic clears four stock Window One Desktop holders, Compatible
  disables our four send arrows, and Revert restores defaults.
- `npm --prefix kwin test`: 969 tests, 136 suites, 969 passed / 0 failed;
  production ES2017 bundle built. `npm --prefix kwin run typecheck`: both
  production and test projects pass.
- Initial full-workspace Rust checks exposed missing Windows constructor/test
  fields (E0063/E0027). Decision 2.3's compile-only `follow: true` fix resolves
  those errors while preserving current always-follow behavior; final
  full-workspace results supersede the initial blocked checks.
- Final `cargo test --workspace --offline`: 1115 passed, 0 failed/ignored
  across 43 reported suite results (including portable Windows tests).
  `cargo clippy --workspace --all-targets --offline -- -D warnings` and
  `cargo fmt --all -- --check`: pass, zero warnings/formatting errors.
  Earlier scoped checks passed 721 tests excluding Windows; full-workspace
  gates are now restored. `just check-portable`: zero normal core
  dependencies/platform leaks.
- `nix build --no-link .#checks.x86_64-linux.native-effect-tests .#checks.x86_64-linux.native-effect`:
  test-enabled effect/KCM and delivery build pass, hermetic CTest 33/33
  verified from the build log.
- `cargo build -p omnitiler --offline`, then all 9 `scripts/*.test.sh`
  (tray uses `TRAY_05B_BINARY="$PWD/target/debug/omnitiler"`): pass.
  Counts: tray 29 fixture + 16 self-test, dev-loop 380, dogfood 572,
  native-dev 163, host-build 93, live-harness 237, Custom Tile harness 131,
  floor-ratio 92; 1713 counted assertions plus uncounted build-kpackage
  contracts. Harness inspection confirmed mocked KWin tools and only a
  private non-KWin tray bus; no live KWin interaction.
- Spec totals unchanged: 74 NORMATIVE / 61 OPEN / 9 PROVISIONAL, 139 scenarios;
  indexes updated without adding requirements/scenarios. Matrix reference
  unknowns and exact native empty-source lifecycle/focus remain TBD.
- Backlog enumerates every affected Windows constructor/caller/match plus
  geometry-only/wildcard consumers, native follow/stay tail and input/catalog
  work. Only the Windows constructor/test compile fix is applied; real
  stay/relative wiring remains in the handoff.
- Item-1 user report recorded separately: "worked perfectly" on a SINGLE
  output, 2026-10-07. Individual edge/>9 cases and exercised presets were not
  specified; multi-output/hotplug/presets remain pending.
- No blocking ambiguity. Decision 2.3 updates compile-fix scope only. No live item-2 claim,
  installs, commits or pushes. `git diff --check` passes.

## Pending user live checks

- Relative send first/last wrap, >9, trailing-empty fill/next spare and sole
  source mover; source/target/focus outcomes for rebound absolute/relative stay.
- Floating-boundary default now follows; explicit stay remains source-view
  preserving, floating frames stable and tiled sides reflow.
- Authentic/Compatible/Revert with stock Window One Desktop arrow holders;
  multi-output scoped rings. These checks are user-owned, not run here.
