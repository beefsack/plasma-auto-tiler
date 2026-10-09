# Position-based output selection

## Goal and scope

- Implement the approved 2026-10-09 selection contract in shared core and KDE.
- Windows receives handoff item 16 only; multi-output stays parked.
- Offline evidence only. Preserve arrival/current-view/lifetime fences,
  work-area placement, R4 source-nearest landing and follow/stay semantics.

## Acceptance and approach

- FULL-rectangle edge-touch adjacency with positive overlap supplies candidates.
- Exhausted moves and explicit sends choose the shared edge containing the
  window-centre projection; if none, largest window-span overlap; final left/top.
- Whole-workspace migration ranks by largest shared edge, then left/top.
- Unreadable topology refuses; no candidate is a no-op; no wrap.
- Record deliberate deviation from COSMIC origin-distance selection.
- Sequential muse-spark units: implementation/regressions, independent contract
  review, offline verification. Lead owns durable docs and backlog integration.

## Verification and decisions

- Baseline e6348e8: KWin 1242, Rust workspace 1270, native CTest 33/33,
  Windows portable allowlist 1118; lint/portable/typecheck/bundle/shell clean.
- Initial worktree clean; three user stashes inspected and left untouched.
- Left/Right project y, Up/Down x. Shared intervals are half-open [start,end),
  evaluated using doubled centres for exact odd-extent halves. Left/top is
  ascending x, then y, then stable output identity. Multiple containing edges
  tie directly by left/top; overlap is used only if none contains the centre.
- Reciprocal edge existence remains required, reverse uniqueness does not.
  Focus navigation retains its existing unique-reciprocal horizontal policy.
- Topology remains adapter-owned: Rust's reusable pure selector mirrors KDE;
  existing protocol carries only the selected pair. No wire/architecture change.
- Deliberate COSMIC deviation: window-centre/span selection instead of origin
  distance; migration ranks shared-edge length independently of focused window.

## Review, corrections and accepted evidence

- Lead rejected initial pinned R4 left/top re-selection: selecting a non-left/top
  candidate could otherwise change the pair between transfer and membership.
  Dispatch target identity is now pinned with the source, checked against fresh
  topology without re-ranking the relocated mover. Removal/drift still refuses
  through existing currency/lifetime fences and forces reconciliation.
- Lead corrected silent skipping of unreadable Rust topology and overlap-ranking
  within multiple centre-containing edges. Regressions distinguish unreadable
  topology from no candidate, mismatched source rectangles, and direct left/top
  ties from the overlap fallback. No accepted behavior remains in conflict.
- Independent muse-spark review found no correctness regressions; its real-Engine
  integration gap was closed with production-entry multi-candidate move/send/
  migration fixtures. They verify selected non-left/top targets, actual planner
  geometry/work-area bounds and native transfer/membership/follow. Separate
  regressions verify delayed arrival follows once and reentrant target removal
  refuses with no later setters. Unsupported reference cells remain TBD.
- Nix initially could not see new untracked Rust files (E0583); staging those
  intended paths repaired the source snapshot. This was an environment/source
  packaging failure, not a product test failure.

## Outcome and verification (2026-10-09, offline)

- Shared `tiler_core::output_selection` exposes window/migration ranking and
  unreadable-topology errors. KDE uses the rules for exhausted directional moves,
  explicit sends and whole-workspace migration; R4 pins `targetOutput` through
  inter-setter/arrival/follow observation. Placement, landing, follow/stay,
  current-view/lifetime fences, float carry and sticky stay retain their rules.
- `npm --prefix kwin test`: 1258 passed, 0 failed (baseline 1242, +16).
  Typecheck and production/test build/bundle pass.
- `cargo test --workspace --offline`: 1288 passed, 0 failed (1270, +18).
  Workspace all-target clippy with `-D warnings`, format check and
  `just check-portable` pass; core has zero normal dependencies/platform leaks.
- `cargo test --locked -p tiler-core -p tiler-protocol -p tiler-kwin-effect-ffi
  -p tiler-windows --offline`: Windows portable Linux allowlist 1136 passed,
  0 failed (1118, +18). No Windows runtime edits or native target locally.
- `cargo build -p plasma-auto-tiler --offline` passes. All nine offline shell
  suites pass: build-kpackage contracts; Custom Tile 131, dev-loop 380,
  native-dev 163, dogfood 572, floor-ratio 92, live-harness 237, host-build 93,
  tray 29 fixture + 16 self-test assertions. Mock host tools only, no live tests.
- `nix build --no-link .#checks.x86_64-linux.native-effect-tests
  .#checks.x86_64-linux.native-effect --print-build-logs --offline` passes
  after the last shared-source correction; actual CTest 33/33 (baseline 33/33).
  No native C++ edits.
- Requirement rows, current decisions, matrix delivery cells, diagnostic guide,
  backlog status, Windows handoff item 16 and user-owned live check updated.
  `docs/principles.md` untouched. Note archived on completion.
- Final whitespace and added-line ASCII checks pass. No blocking review findings,
  unresolved product decisions or dependency changes remain.

## Pending user-owned acceptance

- Two-candidate physical move/send and largest-edge workspace migration, including
  unequal edge lengths and a focused window projecting onto the smaller edge;
  exact native arrival, follow/stay timing and work-area placement.
- Windows multi-output stays parked; item 16 provides selector/fence wiring and
  tests for the later Windows session. No Windows native result claimed.
