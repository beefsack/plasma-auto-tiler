# Portable core K0 baseline

- Goal: establish behavioral fixtures for policy already in Rust before KDE-first extraction.
- Scope: nested splits/gaps, adoption fit with overlapping-window centre fallback, complete membership/float convergence and incomplete-observation refusal.
- Non-goals: product changes, new wrappers/dependencies, K1 visual policy, Windows work, agent-run live KDE checks.
- Acceptance: audit existing coverage; add only missing behavioral evidence; retain the no-normal-dependencies guard; pass all requested offline gates; hand off source-verified manual KDE checks.
- Approach: one fresh bounded muse-spark Worker at a time; Lead reviews diffs and records accepted evidence. Preserve the user's `devenv.nix` change.
- Units: coverage audit, vertical overlapping-adoption fixture and refusal-coverage confirmation, source-verified live-check handover, offline verification (all complete).
- Audit decision: existing exact nested projections and convergence lifecycle fixtures establish those baselines. Do not add arbitrary-depth, convergence-count or primitive-binding tests merely to exercise internals. Vertical overlapping adoption lacks a matching behavioral projection fixture.
- Verification: CI Rust workspace tests, fmt and strict clippy; `just check-portable`; devenv KWin tests/typecheck; offline no-build flake check; diff whitespace check. Native build/CTest only if native files change.
- Outcome (2026-09-30): offline K0 complete. Added only `seed::tests::vertical_overlap_beyond_tolerance_centre_splits`: exact stable-window geometry for both input orders and one centre split. Lead review removed redundant topology/share assertions. No product behavior or dependency changes. User live acceptance remains separate and pending; K1 has not started.

## Accepted coverage

- Geometry: `projection_is_deterministic_gap_exact_and_contained` and `cosmic_default_nested_h_a_v_b_c_matches_effective_outer_8` already establish exact nested gaps/inset, containment and non-overlap; no new fixture.
- Adoption: existing clean H/V, nested/order-independent, overlap-tolerance, configured-gap, centre-split and identical-centres fallback fixtures retained. Added the missing vertical-overlap projected baseline in `crates/tiler-core/src/seed.rs`.
- Convergence: `crates/tiler-core/tests/session_observation_convergence.rs` already establishes retained removals/arrivals, float skew, fresh mixed membership and revision continuity; no new fixture.
- Incomplete refusal: `session_lifecycle::duplicate_unknown_crossdomain_partial_malformed_refused_without_divergence` already asserts partial refusal, no pending/divergence and successful subsequent use; resize/movement/workspace and Engine rollback fixtures cover other paths. A missing member in a complete reconcile is legitimate removal, not evidence of incompleteness.

## Offline evidence

All final commands passed (exit 0):

- `devenv shell --impure -- cargo test --workspace`
- `devenv shell --impure -- cargo fmt --all -- --check`
- `devenv shell --impure -- cargo clippy --workspace --all-targets -- -D warnings`
- `just check-portable` (zero normal dependencies, no platform leaks)
- `devenv shell --impure -- cargo build --locked -p tiler-protocol --example planner_eval`
- `devenv shell --impure -- npm test --prefix kwin` (833 passed)
- `devenv shell --impure -- npm run typecheck --prefix kwin`
- `devenv shell --impure -- npm run build --prefix kwin`
- `just build-rust`
- `devenv shell --impure -- bash -euo pipefail -c 'for suite in scripts/*.test.sh; do TRAY_05B_BINARY="$PWD/target/debug/plasma-auto-tiler" bash "$suite"; done'` (all headless CI shell suites)
- `nix flake check --no-build --offline`
- `git diff --check`

The initial fmt check rejected only the new fixture's long lines; `cargo fmt --all` corrected it before all final gates. No semantic failures. Native build/CTest not applicable: no native files changed.

## User KDE handover

- Follow `docs/live-kwin-testing.md`; user-owned manual/session operations only. Capture actual geometry, membership, focus and scope plus correlated diagnostics, not setter replies alone.
- Test system: normal nested tiling and gap Save should yield canonical non-overlapping rectangles with the configured inner/outer gaps. `plasma-auto-tiler:plan:cmd=<corr> kind=<op> windows=<n> outcome=planned-applied` is defined at `kwin/src/plan-adapter.ts:8990`. Gap reload emits `plasma-auto-tiler:plan:config-reloaded stage=re-read-queued innerGap=<n> outerGap=<n> applied-unconfirmed` at `kwin/src/plan-adapter-entry.ts:5915`; this alone does not prove applied geometry.
- Test system, separately authorized fresh adoption: arrange eligible windows before the first complete observation of a domain with no retained session (`crates/tiler-core/src/engine.rs:829-847`). Opening windows sequentially into a retained domain does not test startup fit. Overlapping stacked windows beyond tolerance should fit with a centre split and project to disjoint stacked rectangles; identical rectangles exercise `no_cut` seed fallback. A pinwheel can fit through centre splits, so it is not a fallback oracle. Existing log: `plasma-auto-tiler:adoption-fit outcome=<fitted|fallback> windows=<n> reason=<reason> centre_splits=<n> correlation=<corr>` (`crates/tiler-protocol/src/planner_protocol.rs:615`).
- Test system: open/close/toggle float and confirm survivor tiling, floated-window exclusion and usable retained state. Nonzero complete-observation convergence emits `plasma-auto-tiler:plan-summary direction=convergence op=<op> correlation=<corr> reason=observation-mismatch removed=<n> admitted=<n> flags_adopted=<n>` (`crates/tiler-protocol/src/planner_protocol.rs:547`); explicit commands need not take this convergence route.
- Test system: select/send between existing same-output workspaces and confirm membership/focus/geometry stay in the intended scope. Send diagnostics use `plasma-auto-tiler:route-diag component=cosmic-send route=send-to-workspace stage=<stage> correlation=<corr> generation=<generation> revision=<revision> diag_seq=<seq> event=<event> outcome=<outcome>` (`kwin/src/workspace-send-adapter.ts:2500`). Write success is `stage=arrival event=write outcome=applied` (`:1725`); successful follow is `stage=follow event=follow outcome=state-confirmed` (`:2044-2045`), requiring observed target membership and focus too.
- Multi-output test system: repeat workspace selection/send on each output in the current mode and confirm the other output's scope behaves according to that mode. Per-output-local isolation and cross-output movement cannot be established on the single-output setup. No output reconnect/displacement expansion is required by this test-only K0 change.
- Incomplete/unreadable refusal remains offline evidence; do not force broken native observations. If naturally encountered, `plasma-auto-tiler:plan:focus-refused-observe` (`kwin/src/plan-adapter.ts:2186`) means no focus plan was dispatched, not an empty-domain removal.

- Risks/open questions: manual KDE evidence pending; no unresolved implementation question. Save diagnostics are explicitly unconfirmed, and fresh adoption requires the correct lifecycle precondition.
- Next action: Orchestrator reviews/stages the three intended files, preserving `devenv.nix`, and coordinates user K0 single/multi-output baseline observations before K1.
- Backlog handover (Orchestrator-owned): K0 offline baseline complete; user KDE baseline pending; K1 remains next and unstarted.
