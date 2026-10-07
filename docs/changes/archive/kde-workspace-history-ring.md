# KDE workspace history and relative ring

## Goal and scope

- Deliver consensus item 1 (R-WS-08/R-WS-11), decisions 1.1-1.5, in the KDE adapter.
- Stable-ID two-view history per output in local/global-unique modes, one shared history; existing scoped ordered ring with wrap, trailing empty and ordinals beyond 9.
- Register toggle and directional letter/arrow bindings; extend native shortcut reconciliation and preset coverage for stock KWin desktop-switch holders.
- Shared Rust core and Windows implementation are outside this piece. No live KWin/Plasma tests or dependency installs.

## Acceptance

- Every successfully observed workspace change records, including native, verified follow and hotplug; same-workspace activation and output focus alone do not.
- Removed/out-of-scope previous IDs clear; disconnected output history is discarded. Reconnect selection is independent of history.
- Selection creates nothing and preserves existing lifecycle, owner/generation/flight and retention fences.
- Offline regression tests cover toggle, invalidation, scopes, ring edges and hotplug; catalog/preset tests cover Authentic holder clearing and Compatible arrow disabling.
- Update spec/matrix, backlog delivery and Windows handoff, pending user live checks; verify offline repo checks and diff whitespace.

## Approach and bounded units

1. Worker: TypeScript native observation/history/ring, routing and offline tests using existing selection/lifecycle seams.
2. Worker: native C++ catalog/known holders/preset tests, following TypeScript action IDs.
3. Lead: independent review, inspect diffs and acceptance evidence, docs reconciliation, full offline checks, stage exact changed files and archive this record.

## Decisions and evidence

- Authoritative decisions and scenario rows read before implementation; H/K previous, L/J next, Meta+Ctrl+Tab toggle.
- Initial worktree clean. No new product decisions selected.
- Native observation owns history, separate from retained displacement mapping.
  Observe before and after hotplug writes: if native A->B and displacement
  B->D occur in one handler, previous is B. Disconnect deletes both previous
  and the observation baseline; return primes a new baseline, then records any
  in-handler return change without resurrecting disconnected history.
- Existing native selection seams serve toggle/ring; no structural Rust changes,
  new retention pins or history-driven reconnect selection. Shared mode has one
  domain history; output focus/loss alone is not a shared workspace change.
- Independent review inspected behavior/catalog/fences and identified missing
  scoped/swap/shared-hotplug coverage, now covered. Lead caught and repaired the
  disconnected displacement-baseline reuse and the pre-handler observation edge.
- First native test run exposed an incorrect table-only key assertion for
  letter/toggle rows; corrected to catalog-scoped key math. Final native suite
  passes; no production workaround or product-intent change.

## Outcome and verification (2026-10-07, offline)

- Implemented R-WS-08/11 and applicable R-WS-15..17; 15 dedicated tests plus
  verified-send-follow coverage in the existing production-entry regression.
- Catalog parity: 75 native/TypeScript bindings (36 plan + 39 workspace);
  19 compiled conflicts. Authentic confirmed Force clears stock desktop-switch
  arrow holders; Compatible disables our four arrows, keeping letters/toggle.
  Existing Revert/default restoration and ordinary settings isolation retained.
- `npm --prefix kwin test`: 936 passed, 0 failed; production ES2017 bundle built.
- `npm --prefix kwin run typecheck`: both production/test projects pass.
- `cargo test --workspace --offline`: 1107 passed, 0 failed.
- `cargo fmt --all -- --check` and
  `cargo clippy --workspace --all-targets --offline -- -D warnings`: pass.
- `just check-portable`: zero normal core dependencies, no platform leaks.
- `nix build --no-link .#checks.x86_64-linux.native-effect-tests .#checks.x86_64-linux.native-effect --print-build-logs`:
  test-enabled native effect/KCM and delivery build pass; hermetic CTest 33/33
  (verified build log via `nix log .#checks.x86_64-linux.native-effect-tests`).
- `cargo build -p plasma-auto-tiler --offline` then all `scripts/*.test.sh`
  with `TRAY_05B_BINARY="$PWD/target/debug/plasma-auto-tiler"`: 9 suites pass,
  1713 counted assertions plus uncounted build-kpackage contracts. All KWin
  tools are mocked; tray uses a private non-KWin bus.
- Spec totals remain 74 NORMATIVE / 61 OPEN / 9 PROVISIONAL, 139 scenarios;
  open/provisional indexes unaffected. Matrix/spec cells explicitly say
  implemented offline, native journey TBD. R-WS-18..20 relative sends remain
  item 2, with only the shared ring foundation delivered here.
- Windows handoff refined in backlog: no shared-core/API repair required;
  stable-ID observation, scope invalidation, Ctrl/Tab classifier/settings,
  selection dispatch and preset work enumerated.
- No live KWin/Plasma testing, dependency installs, Windows/core edits, commits
  or pushes. No outstanding product ambiguity. Pending user live checks cover
  physical wrap/trailing/>9, toggle, stock-holder Authentic/Compatible/Revert,
  and multi-output history/return journeys.
