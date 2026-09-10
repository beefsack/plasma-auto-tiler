# Rust Authority Route Diagnostics

## Goal

Make every current background Rust-path boundary traceable from KWin command
delivery through Planner, portable-session decision, tray/bridge lifecycle,
acknowledgement, and terminal result without exposing window data.

## Scope

- Fixed, opaque, bounded route diagnostics across the Rust command adapters and
  Planner service, portable session outcomes, and tray/bridge lifecycle.
- One per-dispatcher sequence and one per-adapter correlation token.
- Coalesced pointer-flight diagnostics.
- One non-activating current-boot KWin and Planner log viewer.

## Log Contract

- Every line starts with `plasma-auto-tiler:route-diag`. KWin records use a
  closed `stage` plus bounded `key=value` fields; Planner records use bounded
  `route`, `action` or `result`, `corr`, and optional `rev`. Lifecycle records
  add closed `comp`, `event`, `gen`, and `result` fields.
- `seq` joins KWin command dispatch stages. Opaque `corr` joins KWin D-Bus send,
  receive, acknowledgement, verification, and Planner request/result. `gen`
  and `rev` identify the authority binding and plan revision. `route`, `stage`,
  `action`, `event`, `result`, and `decision` are closed categories.
- Logs contain no captions, application content, secrets, raw environment,
  native IDs, owners, PIDs, paths, raw geometry, raw D-Bus payloads, or error
  text. Malformed values become fixed categories; pointer messages are
  coalesced summaries only.
- View existing current-boot logs without activation:
  `scripts/route-diag-follow.sh --follow`
  The `plasma-auto-tiler route-diag` command prints the same source filters.

## Acceptance

- KWin logs command, attach/retry/refusal, exact-three scope count/category,
  owner transition, request, acknowledgement, verification, and terminal
  result. Planner logs correlated route request, reply, and fixed refusal
  categories.
- Tray/bridge lifecycle and portable Session plan/reconciliation outcomes use
  the same bounded sink and correlation where a route has one.
- Logging is best effort and cannot alter authority, timing-sensitive decisions,
  IPC semantics, Session state, fail-closed behavior, or public defaults.
- The current-boot viewer reads the user journal and fixed-string filters the
  shared anchor, so KWin, Planner, and unit-less tray autostart records appear
  together without unrelated visible output or D-Bus activation.

## Verification

- `cargo test --lib` passed 410 tests and `cargo test --lib route_diag` passed
  19 tests. `cargo fmt --check`, `npm run typecheck`, 26 focused bundled KWin
  route-diag tests, `scripts/route-diag-follow.test.sh` (22 checks), and
  `scripts/build-kpackage.test.sh` passed. `cargo clippy --all-targets` had no
  errors and only three pre-existing unrelated warnings.
- A temporary KPackage build under `/tmp/opencode` passed without staging
  output. The read-only `scripts/route-diag-follow.sh` current-boot snapshot
  exited successfully and found no route-diag lines yet. It did not start a
  service, open D-Bus, or mutate KWin or Planner.

## Outcome

- KWin command and D-Bus send/receive, all Planner D-Bus routes, Planner-bound
  portable Session outcomes, KWin/Rust tray and bridge lifecycle, and Planner
  seeding now share bounded route diagnostics and existing visible sinks.
- Planner user-service stdout and stderr are explicitly retained in the user
  journal. The viewer follows current-boot anchored KWin, Planner, and tray
  records together and has no activation path.
- Independent review found and the follow-up implementation fixed missing
  routes, dead Session logging, lifecycle-vocabulary drift, lock-held output,
  journal-retention ambiguity, revision bounds, and repeated tray publication
  noise. No live KWin or Planner mutation occurred.
