# Portable core K2: boundary audit

- Goal: portable settings semantics and action intent used by KDE without changing saved keys, action names/chords, startup behavior or native configuration/Force/Revert ownership.
- Scope/acceptance: audit the existing boundary first; stop before implementation if full K2 needs new messages, generated/shared data, build steps or a synchronized TS copy. Compact behavioral fixtures only; core remains dependency-free.
- Outcome: user decision 2026-09-30, option A below: keep what Rust already owns (gap bounds, typed operations); leave settings and the shortcut catalog in TS until the Windows port needs a shared contract and shows its shape. No product code or fixtures added. K3 (difference classification, also TS-only at `kwin/src/plan-adapter.ts:2360`) is deferred with it; the KDE-first extraction ends at K1.
- Units: fresh muse-spark audit, Lead source review, unchanged-baseline gates and source-verified future-check handover (complete).

## Findings

| Item | Current ownership / boundary |
| --- | --- |
| Gap range | Core already owns `MAX_GAP=64` and `is_gap` (`crates/tiler-core/src/bounds.rs:17,55-58`), used by Engine. Protocol rejects out-of-range values with existing typed diagnostics (`planner_protocol.rs:1040-1067`). |
| Gap defaults / config parsing | TS accepts integer values/numeric strings in 0..64; invalid settings fall back to 8 (`kwin/src/domain-gap.ts:10-43`). It sends normalized integers. Wire parsing does not use config fallback 8: `gap` is required, omitted `outer_gap` defaults to 0 (`planner_protocol.rs:213-220`). |
| Mode/profile/default tiled | TS owns mode default `per-output-local`, profile default `cosmic`, tiling default true. None is in the wire domain or CoreEvent. Mode/profile are startup-only; defaultTiled reload affects newly discovered backing IDs, not retained states (`plan-adapter-entry.ts:5841-5882`). |
| Action intents | Core already receives focus/move/resize/toggle-float/send-to-workspace commands, not KGlobalAccel action IDs, chord aliases or profile. Sticky/maximize/fullscreen and workspace selection execute host-side. |
| Catalog | All three current profiles share the same 36 directional/toggle rows (`plan-adapter-entry.ts:281-398`). The separate 30-row numbered workspace catalog owns digit/shifted-US aliases (`workspace-native.ts:94-149`). |
| Native FFI | The effect already links the Rust staticlib; KCM plugin targets do not. Existing effect exports are not directly callable by KWin JS. Native conflict reconciliation is not the full TS action catalog. A new JS-accessible message boundary would still be necessary. |

Existing behavior fixtures cover gap defaults/boundaries/invalid fallback and wire payloads (`domain-gap.test.ts`), modes and numbered aliases (`workspace-native.test.ts:252-292`), catalog names/chords/profile equivalence and command dispatch (`plan-adapter.test.ts:3735-3897`), and protocol gap refusals. No duplicate fixtures are warranted before choosing a route.

## Scope options

| Option | Consequences | Recommendation |
| --- | --- | --- |
| Retain only what Rust already owns/uses; defer TS-only settings/catalog until Windows needs a shared contract | Core bounds/predicates and typed operations already satisfy this subset. No artificial move or duplicate definitions; full K2 outcome remains deferred. | Recommended. |
| New runtime metadata protocol for settings/action intents | Rust becomes authoritative; TS still maps native bindings. Adds startup/service availability and asynchronous registration concerns, a new contract and failure behavior. Does not inherently require code generation. | Re-scope explicitly before implementation. |
| Generated/shared artifact or parallel TS copy | Adds build coupling or synchronized duplication; changes the ownership model without an existing runtime consumer. User explicitly requires a decision first. | Not recommended. |
| Native FFI plus JS bridge | Reuses Rust linkage but still needs a new script-accessible endpoint/message path; native currently lacks the full catalog. More machinery than direct metadata IPC. | Not recommended. |

- Risks: adding runtime metadata would introduce startup/availability and registration failure behavior. Moving TS fallback defaults into the strict wire validator would change semantics. Existing commands cannot exercise absent catalog/profile definitions.
- Next action: none for KDE; revisit when Windows needs shared settings or action intent.

## Unchanged-baseline evidence

All final commands passed (exit 0); these verify `c1ccbcf`, not a K2 implementation:

- `devenv shell --impure -- cargo test --workspace`
- `devenv shell --impure -- cargo fmt --all -- --check`
- `devenv shell --impure -- cargo clippy --workspace --all-targets -- -D warnings`
- `just check-portable` (zero normal dependencies, no platform leaks)
- `devenv shell --impure -- cargo build --locked -p tiler-protocol --example planner_eval`
- `devenv shell --impure -- npm test --prefix kwin` (833 passed, including native static suites)
- `devenv shell --impure -- npm run typecheck --prefix kwin`
- `devenv shell --impure -- npm run build --prefix kwin`
- `just build-rust`
- `devenv shell --impure -- bash -euo pipefail -c 'for suite in scripts/*.test.sh; do TRAY_05B_BINARY="$PWD/target/debug/plasma-auto-tiler" bash "$suite"; done'`
- `nix flake check --no-build --offline`
- `git diff --check`

Native build/CTest not applicable: no native files changed. Index remains empty; user backlog/toolchain changes untouched. No live tests or implementation attempts.

## Conditional user KDE handover

No live checks are required for this audit. If a later sharing change is authorized, preserve `docs/live-kwin-testing.md` and verify actual state plus physical input; no new live authorization is implied.

- Test system gaps: compare defaults and boundary settings 0/64; invalid fallback stays offline. Verify `Script-plasma-auto-tiler-kwin` saved keys and actual geometry after Save. Existing native line `plasmaautotiler.script-config op=save stage=persist outcome=ok keys=<keys>` (`unifiedsettings_module.cpp:60,747`) proves persistence only. Script line `plasma-auto-tiler:plan:config-reloaded stage=re-read-queued innerGap=<n> outerGap=<n> applied-unconfirmed` (`plan-adapter-entry.ts:5915`) does not prove reflow.
- Test system shortcuts: physically compare HJKL/arrow focus, move and both resize families; float/sticky/maximize/fullscreen; numbered select/send and shifted-US aliases. Existing terminal line `plasma-auto-tiler:plan:cmd=<corr> kind=<op> windows=<n> outcome=planned-applied` (`plan-adapter.ts:8990`) identifies an operation, not its input chord. Native toggles use existing `maximize-toggle`/`fullscreen-toggle` lines (`:2880,2888,2931,2938`); confirm actual state, not just `outcome=invoked`. Compare exact KGlobalAccel names/default chords; no success log identifies a pressed alias. `plasma-auto-tiler:plan:shortcut-failed action=<action> sequence=<sequence>` (`plan-adapter-entry.ts:3327`) diagnoses registration failure only.
- Test system settings timing: mode/profile drift emits `plasma-auto-tiler:plan:config-reloaded stage=restart-required keys=<keys>` (`plan-adapter-entry.ts:5857`) without live adoption. Default-tiled changes emit `plasma-auto-tiler:plan:config-reloaded stage=default-tiled tiled=<true|false>` (`:5879`), affecting newly discovered IDs only. Any session restart remains user-owned.
- PC: repeat existing mode-dependent selection/send on both outputs. Send diagnostics retain `plasma-auto-tiler:route-diag component=cosmic-send route=send-to-workspace stage=<stage> correlation=<corr> generation=<generation> revision=<revision> diag_seq=<seq> event=<event> outcome=<outcome>` (`workspace-send-adapter.ts:2500`); writes use `stage=arrival event=write outcome=applied`, confirmed follow uses `stage=follow event=follow outcome=state-confirmed` (`:1725,2044-2045`). Verify target membership/focus and the other output's current-mode behavior.
- Force/Revert, native binding and config ownership stay host-side. Exercise mutation only when separately authorized; this audit adds no Force/Revert journey.
