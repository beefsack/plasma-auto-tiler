# Four-direction output movement and explicit send

## Goal and scope

- Deliver item 5 decisions 5.1-5.4: exhausted directional crossing in all four
  directions, full-output adjacency, explicit output send with follow/stay.
- Shared Rust core/protocol and KDE adapter/catalog/presets. Windows changes
  limited to compile-only repairs preserving behavior; wiring stays in handoff.
- Offline verification only; no dependency installs or Git commits.

## Acceptance and approach

- Local move rules win first; sole root leaves cross in every direction.
- Unique reciprocal edge-touch with positive overlap uses full rectangles;
  no candidate is a no-op, ambiguous/unreadable topology refuses, no wrapping.
- Explicit send targets the destination current workspace using ordinary
  remembered-leaf/focus-history/root admission and command follow/stay.
- Sticky and intentional float subjects remain excluded; floating workspace
  boundaries transfer membership only and reflow only tiled sides.
- Directional crossing retains edge insertion nearest the source.
- Sequential bounded units: Rust implementation/tests, KDE implementation/tests,
  native catalog/preset integration; review and verify all offline gates.

## Verification

- Core and KDE regressions for crossing/local precedence/sole leaves/topology,
  send admission/follow/stay/eligibility/floating boundaries and arrival fences.
- npm tests/typecheck; workspace Rust tests/clippy/fmt; portable check; native
  effect Nix checks; affected shell harness tests; ASCII and diff checks.

## Review and accepted evidence

- Initial worktree clean; live testing guide read. Item-5 matrix discriminators
  are R-MOV-11..13 and R-OUT-07; R-MOV-09/10 belong to item 3.
- Core adds distinct `SendToOutput` / `MoveToOutput` commands and `SendOutput`
  replies using the canonical transient two-domain ordinary-send machinery.
  Workspace send stays same-output. No Windows edits or compile fixes needed.
- Adjacency is adapter-owned; four-side reciprocity/fingerprinting is shared
  with the protocol. Full output geometry selects the neighbor, while per-
  desktop work areas still drive placement. Forward AND reverse candidate
  uniqueness is required. Directional focus keeps its horizontal policy.
- Initial full-rectangle placement and vertical-focus extension rejected,
  corrected reverse-uniqueness and floating-boundary eligibility/visibility
  gates, and required real Engine fixtures rather than membership-only mocks.
- Real production-entry/Planner fixtures reproduced a lost-source pin: after
  transfer the active mover changed outputs, so the observer rediscovered the
  target as source and could not write geometry or confirm arrival. Source
  output/workspace are now frozen through transfer/follow/stay; actual source
  visibility remains separate. Bypassing the pin makes three Engine rows fail;
  restoring it passes. R4 re-observation needs the same source pin.
- Half-applied output/desktop relocation is not mistaken for departure between
  transfer and membership. Live mover/window-list identity, domain/current-view,
  gaps and tiling-mode fences hold; geometry rejects missing/extra non-movers,
  changed flags and replaced movers. Retired refs with still-readable/writable
  properties cannot receive later membership/geometry/focus writes.
- Independent review found missing ordinary admission cases, a wrong inherited
  last-desktop gate and mid-write lifetime/set gaps; all were resolved. One
  desktop ID shared by two outputs is valid for output send. Exact native
  output plus sole desktop readback gates arrival; delayed signals/deadlines
  cannot replay setters or follow twice. Failure forces both-domain reconcile.
- Core/session/Engine/protocol tests cover local-first vertical moves, compass
  sole-root empty/occupied crossings, no-candidate/reciprocity refusal, unchanged
  R4 edge insertion, ordinary remembered/MRU/empty-root send admission, sticky/
  float ineligibility and follow/source-MRU/null stay. KDE fixtures cover full-
  rect panel gaps, forward/reverse ambiguity, source/target drift, changed modes,
  mid-write removal/replacement/extra members, delayed arrival, only-tiled-side
  floating-boundary reflow and geometry byte-equality with the real Engine plan.
- Native catalog has 124 rows: 92 bound, 32 unbound (including four new output
  stay rows). Eight output-follow rows use Meta+Ctrl+Alt arrows/HJKL. Compiled
  foreign conflict table remains 23 rows; no stock holder was invented. Both
  presets keep the new follow/stay defaults, and stay rows remain rebindable.

## Outcome and verification (2026-10-07, offline)

- Complete coherent item-5 diff; no staged sub-piece remains. Windows adapter
  wiring and native acceptance stay in the exact-site backlog handoff.
- `npm --prefix kwin test`: 1044 passed, 147 suites, zero failed/skipped;
  production ES2017 bundle built. `npm --prefix kwin run typecheck`: both
  production/test projects pass.
- `cargo test --workspace --offline`: 1170 passed, zero failed/ignored across
  44 reported suite results, including 394 portable Windows tests.
- `cargo clippy --workspace --all-targets --offline -- -D warnings`,
  `cargo fmt --all -- --check`: pass, zero warnings/formatting errors.
  `just check-portable`: zero normal core dependencies/platform leaks.
- `nix build --no-link .#checks.x86_64-linux.native-effect-tests .#checks.x86_64-linux.native-effect`:
  test-enabled effect/KCM and delivery build pass; hermetic CTest 33/33 verified
  from the build log.
- `cargo build -p omnitiler --offline`, then all nine
  `bash scripts/*.test.sh` individually (tray uses
  `TRAY_05B_BINARY="$PWD/target/debug/omnitiler"`): pass. Counts: tray
  29 fixture + 16 self-test, dev-loop 380, dogfood 572, native-dev 163,
  host-build 93, live-harness 237, Custom Tile harness 131, floor-ratio 92:
  1713 counted assertions plus uncounted build-kpackage contracts. Harnesses
  inspected for mocked host tools; no live KWin interaction.
- Spec totals unchanged: 74 NORMATIVE / 61 OPEN / 9 PROVISIONAL, 139 scenarios.
  KDE cells/status/indexes, decision pointer, diagnostics and backlog updated;
  pinned baseline evidence and reference unknowns retained. Exact unspecified
  native child order remains TBD. `git diff --check` and added-line ASCII pass.
- No blocking product ambiguity, dependency changes, live testing, commits or
  pushes. Existing native asynchronous/readback timing remains user-owned.

## Pending user live checks

- Two vertically stacked outputs: Meta+Shift+Up/Down crosses only after local
  exhaustion; repeat with sole source window, empty/occupied target and panel
  work-area gap. Horizontal Left/Right still works, including sole leaves.
- Meta+Ctrl+Alt arrows/HJKL explicitly sends before exhaustion to the target's
  CURRENT workspace and follows; rebind directional stay from empty defaults,
  verify source selection/MRU focus and remembered-leaf ordinary admission.
- Floating-workspace boundaries keep membership-only transfer, floating frames
  stable and only tiled sides reflow. No-candidate no-op/ambiguity refusal;
  physical native arrival/focus and per-output/shared scopes need two outputs.
