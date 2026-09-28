# Unfloat admission axis and quiet refresh diagnostics

- Goal: unfloat a window with the same target and axis rules as new-window admission; route quiet refresh classifications to opt-in trace.
- Scope: Rust float-to-tile path and behavior regression; KWin refresh logging and minimal tests. No other placement, drag, or adoption behavior changes; no live KWin testing.
- Acceptance: `H[W1 V[W2 W3]]` -> float W3 -> `H[W1 W2]` -> unfloat W3 -> `H[W1 V[W2 W3]]` on a landscape work area; quiet classifications trace only, other terminals normal; Rust workspace tests/fmt/strict clippy, KWin tests/typecheck green.
- Decision (user, 2026-09-28, option A): unfloat uses exactly new-window placement, with no remembered-origin slot. COSMIC maps a toggled floating window through `tiling_layer.map(window, focus_stack)` like a new window; sway's `container_set_floating` likewise re-tiles it.
- Outcome: unfloat supplies `seed_target_bounds` (focused leaf's projected rect, otherwise domain bounds) to normal admission while retaining the live float rectangle for future floats. The regression in `crates/tiler-core/tests/session_lifecycle.rs` proves `H[W1 V[W2 W3]]` -> float W3 -> `H[W1 W2]` -> unfloat W3 -> `H[W1 V[W2 W3]]` and retained float geometry.
- Outcome: `kwin/src/plan-adapter.ts` logs `terminal=quiet` refresh classifications only with `KWIN_TRACE_ENABLED`; `kwin/tests/refresh-quiet-trace.test.ts` verifies quiet suppression in normal builds and quiet plus dispatch visibility in trace builds.
- Offline verification: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `npm run typecheck` and `npm test` (797 passing) succeeded. No live KWin testing.
- Live acceptance pending: reproduce three-window float/unfloat sequence, check layout and trace event routing; confirm normal versus trace refresh logs.
