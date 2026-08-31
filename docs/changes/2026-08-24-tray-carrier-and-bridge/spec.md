# Specification: Tray Carrier and Command/State Bridge

Ownership and approval:
- Owner: Lead
- Status: The Orchestrator approved the fixture-first contract and the
  pre-start production split on 2026-08-27 under the user's autonomous
  authorization. This document records scope only; it does not implement either
  production unit.

## Intent and Desired Outcome

Record the smallest independently provable state boundary for the approved tray
direction. The KWin script remains unable to own a tray item; this contract does
not implement the D-Bus service, Rust helper, or KWin publisher.

## Scope and Non-Goals

In scope:

- Record that the KWin script cannot truthfully own a persistent system tray
  item or menu.
- Use the approved external Rust StatusNotifierItem (SNI) helper as the
  strict-tray carrier.
- Define and fixture-prove one state-only KWin-to-helper snapshot contract.
- Treat `docs/reference-cosmic-tray-menu.md` as design inspiration only.

Non-goals:

- Implement a tray item, applet, Rust helper, D-Bus service, KWin publisher,
  autostart entry, or production command/state bridge beyond accepted units.
- Treat a Plasma applet as a strict System Tray carrier.
- Expose signals, actions, `OpenSettings`, shell execution, input injection,
  helper-to-KWin traffic, or any route beyond `PublishSnapshot`.
- Make a sender-authentication claim. Session-bus placement plus this fixed,
  state-only whitelist is the security boundary.
- Reproduce COSMIC styling or controls exactly.
- Change `docs/decisions.md`, source outside the exact path list approved for
  the currently dispatched unit, or existing packaging behavior.

### Lifecycle Boundary

- The helper lifecycle has no durable recovery protocol. Each ordinary
  install/start/status/stop/remove command acquires its project lifecycle lock
  before artifact preflight or mutation.
- Normal in-process rollback and exact cleanup remain required. An interrupted
  operation, malformed/replaced artifact, PID ambiguity, watcher error, or
  waiter error fails closed and retains residual state; a later command does not
  infer ownership or retry recovery.
- This boundary preserves the sole `PublishSnapshot` method and excludes 05b
  publisher transitions, crash/power-loss rollback, and hostile same-user races.

## Applicable Principles and Decisions

- `docs/decisions.md#tray`: the Rust SNI carrier, KWin-first backend, KCM
  ownership, distribution boundary, dogfood-only development, and bounded
  user-local authorization are active user-approved decisions.
- `docs/decisions.md#native-c-safety-policy`: the approved Rust-only helper
  selects no additional native C++ scope.

## Constraints

- The fixed session-bus contract is service `org.plasmaautotiler.Tray`, object
  `/org/plasmaautotiler/Tray`, interface `org.plasmaautotiler.Tray1`, with its
  sole method `PublishSnapshot(i schema, s generation, i revision, b enabled)`.
  It is KWin-to-helper only.
- Schema is exactly `1`; `generation` matches `[a-z0-9-]{1,32}`; `revision` is
  an integer from `-2147483648` through `2147483647`; and `enabled` is boolean.
  Positional D-Bus arity and type dispatch errors are outside the method and are
  not custom parser behavior.
- The helper owns its accepted snapshot and freshness clock. KWin owns
  publication and retries after a transport failure. `org.kde.KWin` name
  ownership is the liveness guard, not sender authentication: owner loss clears
  the snapshot and freshness immediately; reacquisition remains empty until a
  new valid publish.
- `enabled` is `TileController.isEnabled`. KWin creates one valid generation for
  its process lifetime, publishes revision `0` at startup, increments the
  revision on each enabled-state transition, and publishes immediately on that
  transition and every 1,000 milliseconds. A transition after revision
  `2147483647` creates a new generation and publishes revision `0`.
- KWin invokes `callDBus` one-way. It makes no delivery or acknowledgement claim;
  each heartbeat invocation is its retry. The helper installs exact
  `org.kde.KWin` owner-change observation before resolving the current owner,
  reconciles that owner without authenticating a sender, clears cache and
  freshness on owner loss or change, and remains stale until a semantically valid
  publish after reacquisition. Helper acceptance does not require revision `0`
  for a valid different generation.
- A valid first snapshot or a valid new generation replaces the accepted state
  and refreshes liveness. For the current generation, a higher revision replaces
  and refreshes; an equal revision with the same `enabled` is replay-idempotent
  and refreshes; a lower revision or equal revision with different `enabled`
  invalidates the state without refreshing. Invalid semantic values, an absent
  KWin owner, and transport failure preserve the prior state without refresh.
- A helper restart begins empty. A later replay after KWin owner reacquisition
  is accepted as a first snapshot. Accepted state is stale when
  `now - refreshedAt >= 30_000` milliseconds; stale state is not exposed as
  current until a valid refresh.

## Acceptance Criteria

- [x] The proposal states that the KWin script is not a tray carrier and that
  a strict tray requires an external SNI helper plus a supported bridge.
- [x] The proposal records a minimal Rust SNI MVP, security constraints, and
  COSMIC-reference limits.
- [x] The active Tray decision selects the carrier, high-level bridge safety
  constraints, settings boundary, distribution boundary, and Rust-only scope.
- [x] The exact fixed state-only contract, public-route boundary, state owner,
  liveness rules, and restart rules are recorded.
- [x] `unit-02a-bridge-contract-fixture` independently accepted a fixture-local
  codec and state-machine proof before production integration.
- [ ] `unit-02b-kwin-publisher` proves KWin publication without expanding the
  fixed public route.
- [ ] `unit-02c-helper-endpoint` proves helper endpoint cache and owner-liveness
  behavior without expanding the fixed public route.

## Unresolved Questions

- Which existing actions, if any, can enter a later mutating whitelist without
  widening the active Tray decision?
- What exact package, installation, update, and removal mechanics implement the
  approved distribution boundary?

## Consequential Decisions

- The fixture is deliberately local to the contract proof: it imports no
  production code and supplies no production implementation. Production work
  may begin only after this unit is independently accepted; it must not broaden
  the sole-method route or treat fixture behavior as a sender-auth mechanism.

Production integration does not begin until the exact bridge contract has an
independently accepted fixture or harness proof and literal canonical gates.
The accepted `unit-02a-bridge-contract-fixture` is that prerequisite for both
production children; neither production child imports its fixture-local codec or
state machine.
