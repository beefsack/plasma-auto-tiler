# Tray Publication Observability

## Goal

- Add bounded, normal lifecycle evidence for the active KWin tray publisher and
  Rust tray endpoint without changing the publication protocol or behavior.

## Scope

- Instrument existing publisher lifecycle/change-send boundaries, endpoint owner
  transitions, publication authorization/state acceptance or refusal, SNI
  projection, and signal-emission failures.
- Reuse generation/revision/enabled only as snapshot identity across the
  KWin/Rust boundary, never as request ancestry.
- Verify the actual development capture route and document any stream limit.

## Non-Goals

- No tray protocol, state, owner authorization, registration, retry, timer,
  persistence, UI, or lifecycle behavior change.
- No generic tracing framework, polling, live testing, dependency, Plan, or
  ambient-topology work.

## Acceptance

- Normal logs identify lifecycle and change-driven publication transitions,
  bounded refusal/failure reasons, and endpoint state transitions without
  identifiers, payloads, arbitrary errors, or periodic-success noise.
- Logging is best-effort and cannot affect publication, locks, authorization,
  timers, signals, or state.
- Tests and capture evidence distinguish KWin send initiation from endpoint
  acceptance and SNI visibility; no false cross-service or panel claim.

## Outcome

- KWin lifecycle records use
  `plasma-auto-tiler:route-diag component=tray stage=tray event={started|enabled-changed|stopped} outcome=ok`.
  Bridge records use
  `plasma-auto-tiler:route-diag component=tray stage=bridge event={send-initiated|send-failed} outcome={ok|failed} generation=<token> revision=<i32> enabled=<bool>`.
  The generation field is included only when it matches the existing
  `[a-z0-9-]{1,32}` protocol validation; revision and enabled are typed values.
  `send-initiated` means only that fire-and-forget `callDBus` was invoked, not
  that Rust accepted the snapshot.
- Rust owner records use
  `component=tray-endpoint stage=owner event=owner-changed outcome={acquired|lost|replaced}`.
  Accepted and validated-transition-refusal publication records carry the same
  `generation/revision/enabled` triple as KWin. Schema/generation-invalid and
  pre-authentication refusals carry only a fixed reason and revision, never an
  unvalidated token. Projection records use
  `component=tray-endpoint stage=projection event=projected outcome={Active|Passive|NeedsAttention}`;
  they describe emitted SNI signals, not panel visibility.
- The matching triple joins a KWin bridge send initiation with an endpoint
  accepted or validated-refusal record as one snapshot state identity. It does
  not correlate repeated heartbeat instances with the same triple, prove that a
  particular fire-and-forget send caused the endpoint record, or establish
  request ancestry. A KWin `send-failed` has no expected endpoint record.
- First initial/change failures are visible. A heartbeat failure after success
  is visible once per snapshot identity/category; identical repeats stay silent.
  A later successful KWin send or materially accepted endpoint state change is
  the recovery record and re-arms later failure reporting. Endpoint owner
  changes also re-arm failure reporting. Accepted duplicate heartbeats and
  steady successful heartbeats remain silent.
- KWin records reach the existing `just dev` KWin-PID journal stream through
  `console.log`. `just dev` redirects only Planner stderr at `justfile:299-300`
  and follows only Planner plus KWin streams at `justfile:1095-1099`; it neither
  starts nor captures the tray endpoint. Home Manager's tray autostart executes
  `plasma-auto-tiler tray-managed` without stdout/stderr routing
  (`home-manager-module.nix:34-44`), and the legacy desktop entry similarly has
  only `Exec=<binary>` (`src/tray_lifecycle.rs:3004`). Regular and managed CLI
  modes inherit stderr (`src/main.rs:5-11`). Source establishes no retained or
  queryable stderr sink for an already-autostarted endpoint, so no practical
  capture command can be given without adding capture/lifecycle ownership.
- Watcher registration/retry behavior is unchanged. Its terminal failures keep
  existing process error handling; no recurring retry success record was added.

## Evidence

- `npm run typecheck` passed.
- `npm test` passed: 937 tests.
- `cargo fmt --check`, focused tray tests, and full `cargo test` passed.
- An independent `worker-muse` review found and the implementation resolved
  endpoint refusal flooding and log writes under endpoint/projection locks; the
  final review found no blocking issue. It checked snapshot-identity claims,
  hostile-token/owner/error redaction, periodic failure/recovery bounds,
  lock/signal ordering, sink failure behavior, capture claims, and static tests.
- `cargo clippy --lib` completed with 16 existing warnings outside this slice.
- Source and offline-test evidence only: no live KWin, Plasma, D-Bus, journal,
  or runtime-residue inspection occurred.
