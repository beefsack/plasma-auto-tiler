# Parent split-axis toggle

## Goal and scope

- Deliver 2026-10-07 decisions item 4.1/4.2 and R-LAY-01: `toggle-orientation` through shared core/protocol and KDE Meta+O.
- Toggle only the focused tiled leaf's immediate parent, including root; preserve order, shares and focus, use existing minimum projection and ordinary single-domain commit.
- Lone leaf and floating focus are no-ops; future admission keeps long-edge selection; singleton collapse is unchanged.
- Follow established layout-command floating-workspace and overlay conventions; stop for any uncovered product ambiguity.
- Windows changes are compile-only, behavior-preserving exhaustive handling; actual Win+O wiring/conflict presets remain an exact-site handoff.
- Offline only; no dependency installation, live compositor operations or commits.

## Units and acceptance

1. Worker: shared Rust command/protocol/Engine/Session, meaningful regression tests, compile-only Windows fixes.
2. Worker: KDE routing/reply validation, shortcut catalog/native presets and offline tests.
3. Lead: inspect implementation and evidence, integrate docs/matrix/backlog, run required offline gates, archive and stage changed files.

## Verification

- Root H/V, nested parent only, double-toggle roundtrip, shares/order/focus, minima, lone leaf, float/no tiled focus, overlays, long-edge subsequent admission; protocol encode/decode.
- KDE routing/actuation/reply validation and native catalog/presets.
- `npm --prefix kwin test`, `npm --prefix kwin run typecheck`, `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all -- --check`, `just check-portable`.
- `nix build --no-link .#checks.x86_64-linux.native-effect-tests .#checks.x86_64-linux.native-effect`, affected `scripts/*.test.sh`, `git diff --check`.

## Evidence and outcome

- Initial worktree clean. Root AGENTS.md and live KWin testing guide read; user explicitly prohibits all live testing.
- Sequential Workers delivered Rust then KDE; Lead inspected source/diffs,
  strengthened discriminating acceptance fixtures and corrected one overlay
  scope error. Independent read-only Worker review accepted the final public
  command/protocol contract, transactional core and KDE routing/validation.
- Session resolves the direct parent with `direct_parent_of_leaf`, flips only
  its axis and preserves children/shares/focus. Projection uses the existing
  hints-aware path; the existing reconciler acknowledgement/verification
  commits one domain. Lone leaf returns `unchanged`, float returns `not-tiled`;
  neither stages a toggle plan. No admission hint or collapse-rule change.
- Wire command is exactly `{"op":"toggle-orientation","window":"<id>"}`.
  Reply detail is exact kind/capability `toggle-orientation`, policy version 1.
  KDE rejects wrong detail, operation/preconditions/float geometry, missing
  coverage and focus bound to another window before writes; ordinary stale,
  correlation and actuation fences remain in force.
- Overlay convention is focused-subject refusal, not domain-wide refusal:
  `kwin/src/plan-adapter.ts:2602-2626` helpers and `requestResize:3203-3209`.
  Sibling overlays dispatch and reproject reserved slots but receive no native
  geometry/state writes. Floating workspace uses existing `isTiledDomain`
  gate. Worker initially added a domain-wide fence; Lead review identified
  that semantic error and one correction replaced it with the existing helpers
  and sibling-overlay dispatch/write-skip fixtures. No unresolved approach.
- New valid-reply test initially expected redundant activation of the already
  active window; one causal harness repair made native active lag observed
  focus, then verified exactly one activation of the retained focused window.
- Nix initially could not see untracked Rust module/test files (E0583/E0599).
  Authorized staging repaired the tracked-source sandbox input; the requested
  two checks then built successfully with `--no-link` and no live installation.

## Outcome and verification (2026-10-07, offline)

- Delivered CoreCommand/SessionCommand/lifecycle capability, Engine retained
  handling, strict protocol, KDE request/entry/facades/Meta+O and native
  catalog/preset selection. Catalog now has 37 plan / 112 native rows; the
  entry has 113 registered actions including the keyless workspace toggle.
  Meta+O has no invented stock holder and stays enabled in quiet presets;
  observed collisions use existing Compatible disabling and fail-closed Apply.
- `cargo test --workspace`: 1145 passed, 0 failed/ignored, 44 reported suites
  (1131 -> 1145), including 394 portable Windows tests. Nine new Session tests
  cover root H/V, exact double roundtrip, `H[A,V[B*,C]]` nested immediate
  parent with unequal shares, root unequal shares/order/focus, actual minimum
  redistribution (300/500 vs 400/400) and overconstraint fallback, lone leaf
  plus wide long-edge admission, float/focus mismatch, overlay completeness
  refusal without mutation and post-toggle long-edge admission.
- Five new protocol tests cover real retained Engine roundtrip/full geometry,
  strict malformed fields/ids, lone/float no-op, typed token JSON encode/decode
  and a carried sibling overlay. No test-only production serializer added.
- `npm --prefix kwin test`: 989 passed, 0 failed/skipped, 142 suites
  (979 -> 989). Includes registered Meta+O callback and facade routing, exact
  body, geometry/retained-focus actuation, malformed detail/focus/envelopes,
  stale correlation, float/no observation/floating workspace, focused overlay
  refusal, sibling overlay write skips, lone-root rejection and busy handling.
- `npm --prefix kwin run typecheck`: production/tests pass.
- `cargo clippy --workspace --all-targets -- -D warnings`,
  `cargo fmt --all -- --check`, `just check-portable`: pass; zero Rust warnings
  or format errors, zero normal core dependencies/platform leaks.
- `nix build --no-link .#checks.x86_64-linux.native-effect-tests .#checks.x86_64-linux.native-effect`:
  both pass. Test-enabled derivation
  `5181i6dkfypc2mzi3nlxzdbp2jxx17k5-omnitiler-native-effect-0.1.0.drv`
  log confirms CTest 33/33, including native shortcut-selection scenario with
  Meta+O catalog/identity, no known conflict, quiet preset behavior, observed
  collision, selection-scoped Apply and own-row clearing.
- `bash scripts/build-kpackage.test.sh`: uncounted archive contracts pass
  (printed negative-case errors are expected); `bash scripts/dev-native-effect.test.sh`:
  163 passed; `bash scripts/nix-host-kwin-build.test.sh`: 93 passed. These are
  fake-tool/private-file fixtures, no live KWin calls.
- `git diff --check`: pass; added lines ASCII. No dependency changes,
  installs, commits, pushes or live compositor/Windows testing.
- Matrix R-LAY-01/05/06 KDE evidence and spec status/shortcut index updated;
  no requirement/scenario added: totals stay 74 NORMATIVE / 61 OPEN /
  9 PROVISIONAL, 139 scenarios, 24 Table A predicates, six layout scenarios.
  Reference WM outcomes/pins unchanged; native admission order/focus remains
  TBD even where offline core desired order/focus is now documented.
- Windows compile fixes: none required; `crates/tiler-windows` untouched,
  workspace tests/clippy and independent `cargo check -p tiler-windows` pass
  on Linux. Existing wildcard reply handling and construction-only command
  usage compile without a compatibility shim. Exact Win+O settings/input/
  Engine/actuation/preset handoff is in `docs/backlog.md`.

## Pending user live checks and handoff

- Meta+O on a root pair flips H/V with order/shares/focus retained; twice
  restores. On `H[A,V[B*,C]]`, only B's immediate parent flips; twice restores.
- Meta+O on a lone root window does nothing; later ordinary admission keeps
  long-edge selection. Float/no tiled focus/floating workspace do nothing;
  focused maximized/fullscreen refuses, sibling overlays keep native state.
- Windows action/catalog/input/presets/owner wiring and native build/runtime
  remain Windows-owned; no physical Win+O suppression claim.
- Open product questions: none. Not done: user-owned KDE native journey,
  Windows wiring/native verification, commit/push (Orchestrator-owned).
- Orchestrator next action: review staged change, commit and push using the
  proposed single-line message. No blocker remains.
