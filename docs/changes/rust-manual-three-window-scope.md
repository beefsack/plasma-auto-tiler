# Rust Manual Three-Window Scope

## Goal

Make the Rust authority capable of one stable, manual three-window focus,
movement, and pointer-resize scope without implying lifecycle automation.

## Scope

- One shared authoritative Rust Session for focus, movement, keyboard resize,
  and pointer resize on the packaged Planner D-Bus path.
- One deterministic, source-evidenced COSMIC-compatible exact-three bootstrap.
- Production KWin adapter wiring and targeted static regression coverage.

## Non-Goals

- New-window tiling, add/remove lifecycle, Legacy fallback, advisory paths, and
  live testing.

## Acceptance

- The four public `Describe*` routes use one acknowledged Session state.
- The only bootstrap accepts exactly three eligible windows in one domain and
  projects left-half A with upper-right B and lower-right C.
- Production Rust adapters establish the scope only through the existing
  request, direct-geometry, acknowledgement, and post-observation contract.
- COSMIC policy remains sourced through `cosmic_v1.rs`.

## Evidence

- `PlannerEndpoint` holds one `ManualTrioService`; all public focus, movement,
  keyboard-resize, and pointer-resize D-Bus methods delegate to it.
- Bootstrap observes public KWin state, requires exactly three contained normal
  windows in one output/workspace, and seeds only through the normal resize
  flight. It refuses all other snapshots without Legacy fallback.
- The shared revision holder admits only the exact-three seed revision and is
  copied across dispatcher recreation. Focus has the same pending mirror and
  terminal fencing as movement and resize.
- ManualRuntime convenience operations are test-only; no alternative Session
  authority is production-reachable from Planner.
- Static verification passed `cargo fmt --check`, `cargo clippy --lib -- -D
  warnings`, 21 focused Rust tests, KWin typecheck, and 235 isolated KWin
  adapter tests. No live KWin action, package build, or generated-output change
  occurred during final verification.

## Outcome

Static production wiring is complete. Rust mode remains opt-in with Legacy as
the default and refuses without invoking Legacy. New-window lifecycle,
add/remove/collapse, drag/drop, settings, persistence, and default promotion
remain out of scope.

## Next Action

After the user rebuilds and starts a new session, run the one exact-three
Rust-mode focus, movement, keyboard-resize, and pointer-resize manual smoke.
