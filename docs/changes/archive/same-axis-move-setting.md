# Same-axis move setting

- Follow-up 2026-10-08: functional value IDs `group-with-neighbor` /
  `swap-with-neighbor` delivered offline, superseding the IDs in this historical
  record; no aliases or migration. [D1 delivery](admission-and-move-settings.md).

## Goal and scope

- Deliver decisions 2026-10-07 item 3.1/3.2: global `cosmic-wrap` default and `flat-swap` alternative in shared Rust core/protocol and KDE config/KCM.
- Flat swap changes only R2c adjacent direct leaf siblings; shares travel with windows. Group neighbors and boundary behavior retain current rules.
- Settings affect subsequent commands without rebuilding trees. Missing protocol field defaults to wrap.
- Windows changes are compile-only defaults preserving behavior; adapter wiring is an exact-site backlog handoff.
- Offline verification only; no live KWin/Plasma operations, dependency installation, or commits.

## Acceptance and units

1. Shared enum, command/protocol propagation, planner/apply validation, core and protocol regression coverage, Windows compile fixes.
2. KDE config parsing/live reread, move requests, KCM control, existing offline/static/native test coverage.
3. Lead review/integration, matrix/spec/backlog updates, full requested offline checks, archive and stage intended changes.

## Verification

- Core: N-ary leaf swaps both directions with unequal shares; group neighbors and group ends unchanged; default wrap; strict apply.
- Protocol: missing/default decode and encode plus invalid enum rejection.
- KDE: configuration validation and subsequent-move reread; KCM load/save/default control coverage.
- `npm --prefix kwin test`, `npm --prefix kwin run typecheck`, `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all -- --check`, `just check-portable`.
- `nix build --no-link .#checks.x86_64-linux.native-effect-tests .#checks.x86_64-linux.native-effect`; affected shell test suites; `git diff --check`.

## Decisions and evidence

- Authoritative decisions: `docs/decisions.md`, R-MOV-03 and consensus additions
  item 3.1/3.2; item-3 matrix rows are R-MOV-03, R-MOV-09, R-MOV-10.
  R-MOV-11..13 belong to item 5.
- Initial worktree clean. Sequential Workers delivered Rust then KDE; an
  independent read-only Worker reviewed the public contract and apply rules.
- Review found acceptance test gaps, now closed: leftward unequal-share apply,
  N-ary protocol missing/default wrap discrimination, root/nested boundary
  parity, and KCM same-axis retry/combined saves.
- Independent follow-up review accepted the corrected tests, public contract,
  KDE integration, Windows exact-site handoff and offline-only delivery claims.
- Flat-swap uses `SwapNeighbor { rule: R2c }`; strict apply requires FlatSwap,
  3+ children, parallel group, direct adjacent directional leaf siblings.
  R2a remains binary-only; a forged flat-mode leaf wrap refuses. R2b/group
  wraps and R3/R4/boundaries retain their current rules.
- `Session::propose_move` remains the default-wrap entry; Engine passes the
  typed setting through `propose_move_with_same_axis`. Protocol validates exact
  tokens before constructing the typed core command. KDE omits the default
  wire field and emits explicit `flat-swap`; missing decodes to wrap.
- KDE caches validated `sameAxisMove`, rereads on `Options.configChanged`, and
  supplies it per move. Reload changes no tree or shortcut registration.
  KCM Save uses the existing reconfigure request/retry path, reports pickup
  unconfirmed, and reserves restart-required state for workspaceMode.
- Lead's added codec round-trip assertion initially failed compilation because
  `SyncCommand` is deserialize-only (E0277). One causal test-only repair
  encodes the actual validated enum wire token into JSON and decodes it back;
  no production codec API added. Final full-workspace checks pass.
- Initial final Nix command exceeded the 120-second tool limit. Retried with
  a 600-second limit; both native builds succeeded, CTest 33/33 confirmed in
  the final test-enabled derivation log. Worker-created `result` link removed
  by that Worker; final commands use `--no-link`, no live installation.

## Outcome and verification (2026-10-07, offline)

- Delivered shared enum/command/protocol/planner/apply plus KDE config, legacy
  config form, unified KCM, and subsequent-move reread. Matrix R-MOV-03/09/10
  KDE cells updated with offline evidence; no reference votes/live evidence
  added. Spec totals unchanged: 74 NORMATIVE / 61 OPEN / 9 PROVISIONAL,
  139 scenarios; move index remains 13 scenarios.
- `npm --prefix kwin test`: 979 passed, 0 failed, 140 suites (969 -> 979).
  `npm --prefix kwin run typecheck`: production and tests pass.
- `cargo test --workspace`: 1131 passed, 0 failed/ignored, 43 reported suites
  (1115 -> 1131), including 394 portable Windows tests. Core covers N-ary
  both directions with unequal shares/focus, vertical planning, R-MOV-10
  group neighbors, default wrap, mode/operation forgeries, R2a/R3 parity,
  root ends with/without adjacency, and nested group-end escape.
- Protocol tests cover missing/explicit default equivalence in a discriminating
  R2c fixture, flat swap, JSON encode/decode of validated tokens, typed enum
  conversion, unknown/mistyped values and wrong field spelling.
- `cargo clippy --workspace --all-targets -- -D warnings`,
  `cargo fmt --all -- --check`, `just check-portable`: pass; zero warnings,
  formatting errors, normal core dependencies or platform leaks.
- `nix build --no-link .#checks.x86_64-linux.native-effect-tests .#checks.x86_64-linux.native-effect`:
  both builds pass, hermetic CTest 33/33. Existing native save scenario now
  covers default/missing/invalid config, both tokens, Defaults/save/reread,
  same-axis-only failure/retry, and combined gap+same-axis success/failure.
- Affected packaging/native shell suites: `bash scripts/build-kpackage.test.sh`
  passes its uncounted archive contracts; `bash scripts/dev-native-effect.test.sh`
  163 passed; `bash scripts/nix-host-kwin-build.test.sh` 93 passed. These use
  fake tools/private fixtures, no live KWin calls. Other scripts unaffected.
- `git diff --check`: pass; added tracked lines are ASCII. No dependency
  changes, installs, commits, pushes or live KWin/Plasma tests.
- Windows compile fixes only: `src/tiling_sys.rs:6102` SnapOp::Move constructor
  and `tests/snapkey.rs:915` engine_focus_moves_through_nested_topology
  constructor use `same_axis_move: SameAxisMove::CosmicWrap`. Schema, UI,
  live polling/last-good integration and real move-setting wiring remain
  exact-site handoff in `docs/backlog.md`, per D1/2.3.

## Pending user live checks and handoff

- Toggle KCM Same-axis move between Cosmic wrap and Flat swap; move an interior
  leaf in an N-ary group and verify wrap vs flat identity order, unequal shares
  traveling, retained mover focus, and group-neighbor/group-end parity.
- Verify Save live reread without restart and no tree rebuild, including
  switching back on existing nested trees. User-owned; no live result claimed.
- Windows native build/runtime and real settings wiring remain Windows-owned;
  only Linux portable Windows compilation/testing was performed here.
- No blocking ambiguity or open product question. Orchestrator next action:
  review the staged change and commit/push using the proposed single-line message.
