# Dev Command Unification

## Recipe Layout

- `just build-rust` builds the Rust Planner.
- `just build-kwin-script` builds and verifies the KWin script bundle.
- `just build-native-effect` builds and stages the active-border
  effect, drag-oracle effect, and active-border KCM.
- `just build` aggregates those three builds.
- `just dev [verbose|trace]` accepts only a known DOWN dev state, runs `just build`,
  warns about the native session boundary, then retains the existing foreground
  `dev-on`/log-tail/receipt-bound `dev-off` lifecycle.

Reason: one aggregate gives the foreground loop a complete build, while each
independently editable component retains a cheap direct command.

## Native Session Boundary

- KWin's documented `/Effects` D-Bus interface exposes `loadEffect` and
  `unloadEffect` for already discoverable effects. It has no operation to add a
  plugin path, rescan a newly staged `QT_PLUGIN_PATH`, or replace a loaded
  same-path binary.
- `plasma-workspace/env` supplies `QT_PLUGIN_PATH` when a new Plasma session
  starts. It cannot alter the environment or plugin loader of the already
  running KWin.
- Therefore every successful `just dev` prints exactly:
  `warning: native effects staged under target/kwin-native-effect-stage are not live in this already-running KWin; plasma-auto-tiler-active-border.so and plasma-auto-tiler-drag-oracle.so remain stale until logout/login.`
- A logout/login is unavoidable after a native rebuild before KWin can use the
  staged binaries. The drag oracle has no KCM in the current CMake targets;
  the three staged artifacts are its effect plus the active-border effect and
  KCM.

## Verification

- Static: `just build`, `just --fmt --check`, `git diff --check`, `cargo test`
  (232 unit tests plus integration suites), `npm test --prefix kwin` (426),
  `npm run typecheck --prefix kwin`, and all `scripts/*.test.sh` passed.
- Shell evidence: `dev-loop-split` (`PASS=276 FAIL=0`), `dogfood-install`
  (482), `live-test` (237), `custom-tile-acceptance` (131),
  `floor-ratio-feasibility` (92), and `build-kpackage`. The retired tray lifecycle
  suites were replaced by the AR13 `tray-05b` private-bus single-instance check.
- The hermetic dev-loop coverage proves menu/dry-run structure, all three
  build branches, all staged artifacts, DOWN-only build ordering, build-failure
  refusals before lifecycle mutation, the exact native warning, and existing
  receipt-bound lifecycle refusals.
- Static-only: no `just dev`, `just dev-on`, `just dev-off`, `just reload`,
  KWin D-Bus call, effect operation, or session action was run.

## Follow-Up Diagnostics

- `just dev` now tails every KWin journal line containing the exact shared
  prefix `plasma-auto-tiler:` rather than only `plasma-auto-tiler:plan`.
  The existing `grep --line-buffered`, `[kwin]` label, FIFO streams, and
  combined-log flow remain unchanged.
- Hermetic dev-loop coverage feeds a
  `plasma-auto-tiler:route-diag:drag-pull action=dispatch` line through the
  journal fixture and proves it reaches the labelled KWin stream.
- Follow-up static verification: `scripts/dev-loop-split.test.sh` passed
  `PASS=277 FAIL=0`; `just --fmt --check` passed.

## Logging Levels

- `just dev` and `just dev verbose` retain bounded lifecycle, terminal,
  rejection, and refusal diagnostics. `just dev trace` compiles the KWin trace
  bundle and enables bounded structural Planner request/reply detail through
  `PLASMA_AUTO_TILER_TRACE=1`.
- Trace-only output includes Plan dispatch/per-window geometry dispositions,
  exclusion observations, workspace-send geometry and native-hook detail, and
  normal drag pull/verdict records. Failures and transaction/follow summaries
  remain visible without trace.

## User-Owned Checks

- From a known DOWN state, run `just dev`, confirm the full-build output and
  exact native warning, then Ctrl-C and confirm `just dev-status` reports DOWN.
- To test freshly built native effects, restart into a Plasma session whose
  KWin launch environment includes
  `QT_PLUGIN_PATH=$PWD/target/kwin-native-effect-stage`; only after that
  session boundary may effect discovery/loading be tested.
