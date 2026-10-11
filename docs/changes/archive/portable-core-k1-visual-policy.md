# Portable core K1 visual policy

- Goal/design (accepted 2026-09-30): portable border, preview and underlay policy in `tiler-core::visual`, seven POD exports in the existing effect FFI crate, thin Qt adapters. Qt keeps the original QColor and supplies quantized alpha. No new dependencies, ownership or transport.
- Boundary: native maximize-mode decoding, first-signal/endpoint readiness, scene placement and signal/modifier timing stay host-side. Removed unused `ACTIVE_BORDER_THICKNESS`; existing POD contracts unchanged. Calls are event-rate, allocation/lock-free; no runtime benchmark claim.
- Simplification decision (2026-09-30): real inputs are finite window-scale values. Use natural `x - gap`, `w + 2.0 * gap` geometry. Removed all IEEE-edge fixtures and arithmetic-order comments. The original C++ behavior tests exercise Qt adapters through Rust; all newly added C++ tests/helpers/includes were removed.
- Coverage: nine compact core behavior tests (one per function), sentinel -1/0/explicit extension, fractional gap and preview bounds. One sizeof-only FFI test follows `group_highlight::pod_state_layout_matches_ffi_header`; no byte-normalization precedent, so no normalization test. Header retains only sizeof asserts. Static TS pins cover minimal color routing and native readiness delegation.
- Files: core `src/{lib,visual}.rs`; FFI `src/{lib,visual,group_highlight}.rs`; native `activeborderlogic.h`, `visual_policy_ffi.h`, `CMakeLists.txt`; two native static TS suites; extraction status and this note. `activeborderlogic_test.cpp` has no diff.
- Review/status: accepted design and prior independent migration review had no blocking findings. Simplification and full gate rerun complete; no requested change declined. User K1 visual acceptance pending; K2 unstarted. K0 is accepted test-only work with no live checks required.

## Accepted gate evidence

All final commands rerun after simplification passed (exit 0):

- `devenv shell --impure -- cargo test --workspace`
- `devenv shell --impure -- cargo fmt --all -- --check`
- `devenv shell --impure -- cargo clippy --workspace --all-targets -- -D warnings`
- `just check-portable` (zero normal dependencies, no platform leaks)
- `devenv shell --impure -- cargo build --locked -p tiler-protocol --example planner_eval`
- `devenv shell --impure -- npm test --prefix kwin` (833 passed, including both native static contract suites)
- `devenv shell --impure -- npm run typecheck --prefix kwin`
- `devenv shell --impure -- npm run build --prefix kwin`
- `just build-rust`
- `devenv shell --impure -- bash -euo pipefail -c 'for suite in scripts/*.test.sh; do TRAY_05B_BINARY="$PWD/target/debug/plasma-auto-tiler" bash "$suite"; done'`
- `just build-native-effect` (host-matched KWin 6.7.5 derivation, all three plugins staged under `target/kwin-native-effect-stage`)
- `devenv shell --impure -- nix develop <kwin-derivation> --command bash -euo pipefail -c 'export PATH="<cargo-1.98.1>/bin:<rustc-wrapper-1.98.1>/bin:$PATH"; cmake --build target/kwin-native-k1-test-build'` (generalized derivation/toolchain placeholders; ran in the host-matched KWin 6.7.5 derivation shell with Cargo/Rust 1.98.1)
- `devenv shell --impure -- nix develop <kwin-derivation> --command bash -euo pipefail -c 'export PATH="<cargo-1.98.1>/bin:<rustc-wrapper-1.98.1>/bin:$PATH"; ctest --test-dir target/kwin-native-k1-test-build --output-on-failure'` (30/30, current rebuilt binaries and native validators; same generalized placeholders)
- `nix flake check --no-build --offline`
- `git diff --check`

- Repairs: formatted one new assertion; direct devenv native rebuild lacked Qt includes, so rebuilt in the existing host SDK environment above. Discarded the stale CTest result after the failed build; accepted only the post-rebuild 30/30 run. Prior static-pin/range-lint repairs remain resolved. No semantic failures or toolchain changes.
- Verified the four K0 index hashes unchanged: seed `0776d21`, backlog `268e565`, K0 note `4973c62`, extraction `7033846`. No live agent tests; user's `devenv.nix` untouched.

## User K1 KDE handover

- Use the authorized delivery workflow to exercise the loaded K1 effect; follow `docs/live-kwin-testing.md`. Capture actual frame/focus/state and pixels plus current-PID user-journal diagnostics. No new lifecycle authorization is implied.
- Test system: focus an ordinary window; compare theme enabled/disabled, fallback color, fractional border gap and width through existing settings. Expect the same color and outline offset/thickness. Existing visibility line: `plasma-auto-tiler:active-border:visible vis=<0|1> reason=<reason> appletPopup=<0|1>` (`kwin/native-effect/activewindowborder.cpp:926`). Eligible ordinary state is `vis=1 reason=eligible appletPopup=0`; this line does not report color/geometry.
- Test system: fullscreen, horizontal-only maximize, vertical-only maximize, full maximize, and focus an applet popup; restore ordinary focus between suppressed states. Expect no border on suppressed targets and restored border on eligible targets. For sampled active targets, reasons are `fullscreen`, `maximized`, `applet-popup` (popup flag 1), then `eligible`. Minimize/close may retarget an ordinary window without a visibility flip; do not require a `minimized`/`deleted`/`no-window` line in that case. Missing/deleted predicates are fully covered offline. Visibility logs are first-evaluation/flip-only (`:921-922`), and reasons have precedence (`:176-200`).
- Test system: focus a nested group member, establish passive modifier observation, hold/release Meta, then repeat on a lone root leaf. Expect a translucent underlay below group members only while held, none for the lone leaf. Existing native line: `plasma-auto-tiler:group-highlight:transition anchor=<anchor> members=<n> first=<0|1> meta=<0|1> foc=<0|1> ep=<0|1> vis=<0|1>` (`:972`). Visible nested state has `anchor=selected first=1 meta=1 foc=1 ep=1 vis=1`; lone leaf uses script `plasma-auto-tiler:group-highlight:cleared reason=no-parent-group` (`kwin/src/active-group-highlight.ts:786`; existing core `root_leaf_has_no_parent_group` fixture). An accepted setter can establish visible state without a separate transition line; setter format at `activewindowborder.cpp:939` carries the same flags plus `outcome=<outcome>`.
- Test system: compare underlay extension "Match border width" (-1) at two border widths against explicit extension 0. Expected per-side pad: `gap + 2*width` for -1, `gap + width` for 0, with unchanged below-member placement. Logs do not carry extension/geometry; verify actual settings and pixels.
- Test system: drag a tiled member toward a valid slot, verify preview, then cancel and repeat with a successful drop. Existing lines: `plasma-auto-tiler:plan:drag-preview-settled correlation=<drag> outcome=<outcome> reason=<reason>` (`kwin/src/plan-adapter.ts:3895`), `plasma-auto-tiler:route-diag:drag-preview-shown correlation=<drag>` (`kwin/src/plan-adapter-entry.ts:4646`), `plasma-auto-tiler:route-diag:drag-preview-cleared correlation=<drag> reason=<finish|refused|terminal>` (`:4451,4641,4427`). Expect preview pixels to disappear on finish/cancel; shown is a submission diagnostic, not delivery proof. Invalid native rectangles clear without a log (`activewindowborder.cpp:1096-1124`); invalid-bound coverage is offline, no forced live trigger.
- Multi-output additional coverage: repeat ordinary border/group/preview checks on each output and across differing existing scale/coordinate origins, including a negative origin if already configured. Expect correct remap/placement, same suppression and same log forms. No separate K1 multi-output policy or scale log exists; the single-output test system covers the portable decisions.
- Risks/open questions: loaded-build and visual acceptance pending; no unresolved implementation question. Transition logs are edge-only and do not establish pixels/stacking by themselves.
- Next action: Orchestrator reviews the K1 working-tree delta without disturbing staged K0/user changes, then coordinates and records user K1 checks before K2. Backlog handover: K1 offline complete, user KDE acceptance pending; K2 unstarted.
