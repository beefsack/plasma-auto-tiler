# POC3 Precomputed Host Intents

## Goal

Replace the failed live Rust planner transport with byte-locked offline
Rust-generated intent fixtures, while retaining a host-only KWin one-shot
adapter that applies only the validated receipt-owned diagnostic trio.

## Scope

- Stop only the validated failed planner before implementation.
- Rust remains the sole authority for start, right-focus, and one structural
  move tree/share/focus transitions.
- Host commands validate KWin, receipt, three PID/tick/app-id/slot identities,
  and scope before a one-shot KWin script applies one precomputed intent.
- No initial layout is applied in this unit. Production remains suspended.

## Non-Goals

- No production/startup, D-Bus planner, shortcuts, persistence, tray, KCM,
  Custom Tiles, workspace/output mutation, or terminal management.

## Acceptance

- Fixtures are versioned, byte-locked, and include operation identity and
  preconditions.
- Adapter has no TypeScript movement/topology policy and handles Script0 with
  exact unload/absence verification.
- Static tests cover identity/scope/geometry/convergence/one-shot/cleanup
  refusals and partial application.

## Outcome

- Planner PID `3725709` / owner `:1.1545` was receipt/PID/tick/executable/owner
  validated, then stopped. The process, planner state, and D-Bus owner are
  absent. The live trio and suspended production state were preserved.
- `poc3-host-pilot-v1` is Rust-engine generated and byte locked. It exports
  start `H[A,V[B,C]]` focus `A`, focus-right to `B`, then move-down `swap/R2a`
  to `H[A,V[C,B]]` focus `B`.
- The host route validates the byte-locked fixture, exact trio/scope/KWin state,
  source state, and Script0-capable lifecycle for every one-shot action. It has
  no Planner dependency or TypeScript movement policy.
- Focused Rust, TypeScript, shell host-pilot/action, package, Clippy, format,
  and diff checks passed. Independent review findings on fixture-byte authority
  were corrected; no live layout ran.
- Next action: separately authorize `start` for the current trio. This change
  deliberately stops before that checkpoint. Final strict trio validation then
  failed closed on unreadable supervisor executable identity despite live known
  PID/start-tick reads, so `start` is ineligible until separately resolved or
  revalidated.
