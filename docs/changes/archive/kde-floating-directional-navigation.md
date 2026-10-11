# KDE floating directional navigation

## Goal and scope

- User decision 2026-10-05: KDE float-origin directional focus follows COSMIC;
  ordinary and sticky floats share the floating candidate layer. Tile-origin
  behavior stays unchanged. Windows implementation waits for the next PC session.
- Deliver focus, then explicit stateless half-screen floating snaps. Stop before
  persistent half/quarter/maximize/transfer state or new transfer machinery.
- No live KWin/Plasma testing; test-system acceptance is user-owned. Never modify or
  stage the user-owned `devenv.nix` change.

## Accepted source findings and design

- COSMIC `3d55cba0`: float focus compares top-left positions on the requested
  axis, ignoring perpendicular distance. Up/Left include equal positions and
  choose first minimum; Down/Right require positive movement and choose last
  nearest tie. Candidate iteration is sticky first, then ordinary floats.
- KWin uses native observation encounter order within those layers; ties can
  differ from COSMIC's native Space ordering. Tiles are never local candidates.
- COSMIC misses navigate workspaces on the configured axis, otherwise outputs.
  Preserve our existing edge policy: no workspace cycling; Up/Down retain;
  Left/Right use reciprocal adjacent output remembered eligible tiled focus,
  or retain if unavailable. Tile-origin focus/move are unchanged.
- Local float search uses existing native observations synchronously. A minimal
  internal focus flag is required for cross-output fallback because the existing
  tiled-focus command rejects floating subjects before consulting remembered
  target focus. Float replies carry `from_leaf: null` and a
  `focused-floating-window` precondition, preserving an honest leafless source
  even when the source has no tiles. Preserve reply fences and core
  remembered-focus authority.
- Half-snaps are explicit user geometry actions within the floating layer, not
  tile admission. Repeated arrows request that half again. COSMIC's later snap
  transitions need per-window state, maximize integration and workspace/output
  transfer handling, and are deferred.
- Exact COSMIC half geometry uses `layers.non_exclusive_zone()` (work area)
  and the inner gap only; separate outer gap is ignored. For right:
  `x = bounds.x + floor(width/2) + floor(inner/2)`,
  `w = floor(width/2) - floor(3*inner/2)`, `y = bounds.y + inner`,
  `h = height - 2*inner`. Left/Up/Down use the corresponding halves. Native
  fullscreen/maximized, interactive resize and incompatible declared sizes
  refuse; one write, no automatic retry or reassertion after client clamping.

## Units and acceptance

1. Research: confirm source metrics, ties, fallback and ownership. Accepted.
2. Focus: implementation and tests for float/sticky candidates, misses,
   cross-output fallback, tile exclusion and unchanged tiled navigation.
   Independent review found false source-leaf binding and float-only source
   retention in the first implementation; repaired once with the leafless
   contract and immediate ineligible-subject refusal. Review accepted the repair;
   output-local sticky visibility and duplicate-observation fencing confirmed.
3. Half-snap: bounded explicit geometry writes with identity, single-flight,
   overlay and anti-fighting fences, tested for all four directions and sticky.
   Review identified missing causal post-snap reconcile and floating-workspace
   fence coverage. Tests repaired once: actual geometry signal, debounce,
   real Engine reconcile and callback preserve ordinary/sticky frame and focus.
4. Independent native-write/internal-contract review findings resolved; records
   updated and all requested gates passed. Focus commit `a41caeb` precedes the
   half-snap/records commit. Only intended files staged; user-owned dirty
   `devenv.nix` excluded.

## Verification

- `kwin/`: `npm test`, `npm run typecheck`, `just build-kwin-script`.
- With Rust changes: `cargo test --workspace --offline`,
  `cargo fmt --all -- --check`,
  `cargo clippy --workspace --all-targets -- -D warnings`, `just check-portable`.
- Root `git diff --check`. Live checks remain pending and are not run here.

## Outcome

- Delivered KDE ordinary/sticky float-origin focus and four-direction
  stateless half-snaps. Tile-origin behavior unchanged. Minimal internal focus
  flag and honest leafless cross-source contract added; no FFI changes.
- Final gates: 897 KWin tests, 1107 Rust workspace tests, zero failures.
  Typecheck, script build, formatting, strict clippy, portable check
  (`tiler-core` has zero normal dependencies and no platform leaks), and root
  diff check passed. Rust total includes 37 doc tests; Windows Linux suites
  supply mock/shared-core evidence only, not native implementation acceptance.
- Meaningful feature regressions: 27 float-focus tests, four core float-cross
  scenarios and protocol end-to-end flag/contract/misuse checks; 22 half-snap
  tests plus two real-Engine post-snap geometry-signal/reconcile tests.
- Records: decisions, matrix R-FLT-07..11 and focus/snap variants, backlog.

## Test-system live check (user-owned, pending)

1. Use the normal user-owned development lifecycle to load this revision's
   script and rebuilt Planner together. On a tiled workspace, leave A/B tiled
   and float F/G with `Meta+G`; place G right of F (different y is fine).
2. Focus F, press `Meta+Right`: G receives focus, never nearby tile B.
   Focus B, press `Meta+Left`: tile A wins and floats are skipped. Expected
   local float log: `omnitiler:plan:focus-float-applied direction=right`.
3. Leave only F floating. `Meta+Right` on the single-output test system retains F:
   `focus-float-retained direction=right reason=no-target`. Up/Down misses
   retain as well; no workspace cycle. If using adjacent horizontal outputs,
   a miss may focus that output's remembered eligible tile (`planned-applied`).
4. On F press `Meta+Shift+Right`, then Left/Up/Down: F fills the requested
   work-area half, remains floating and focused, and tiles keep their layout.
   Repeat Right: right half again, no transfer. Right then Up: top half,
   not a quarter. Expected: `move-float-applied direction=<direction>`.
5. Make F sticky with `Meta+Shift+G`; repeat focus toward ordinary G and the
   half-snaps. Wait for post-snap reconciliation: F keeps frame, focus and
   stickiness. A reconcile that names survivor focus emits
   `focus-skipped kind=reconcile ... reason=floating-active`; no later jump.
6. Inspect current KWin-PID user journal diagnostics via the existing lifecycle
   diagnostics command. Unexpected `focus-float-refused-stale`,
   `move-float-refused-stale`, `move-float-write-failed`,
   `move-float-focus-failed`, or `kwin_scripting` errors fail the journey.
   Declared-size refusal logs `move-float-refused-constraints` and does not fight.

## Remaining cost and next action

- Next action: user runs the test system focus/half-snap/reconcile check above.
- Windows: implement and verify native ordinary/sticky float focus and snaps
  in the next PC session; existing refusals remain there. Shared constructor
  compatibility edits set `float_subject: false`, without Windows behavior change.
- Deferred COSMIC snap transitions require per-native-window snap state,
  invalidation on manual move/resize/state/lifetime changes, quarter geometry,
  maximize/restore ownership, and verified floating workspace/output transfer
  paths (sticky included). This is a separate stateful slice, not half-rectangle
  arithmetic. Do not add it before this scoped delivery is live-accepted.
- Residual risks: equal-axis ties reflect KWin native order rather than COSMIC
  Space order; applications can clamp explicit geometry, with no reassertion.
  The internal leafless reply needs the rebuilt Planner and script together.
