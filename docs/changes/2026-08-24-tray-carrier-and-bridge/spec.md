# Specification: Tray Carrier and Command/State Bridge

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-25 by Autonomous Orchestrator for durable proposal artifacts only; implementation and governance remain unapproved.

## Intent and Desired Outcome

Record a durable, implementation-ready boundary for this project's potential
tray control without claiming that the current KWin script can own a tray item
or that any tray behavior is approved.

## Scope and Non-Goals

In scope:

- Record that the KWin script cannot truthfully own a persistent system tray
  item or menu.
- Propose an external Rust StatusNotifierItem (SNI) helper as the minimum
  strict-tray MVP, contingent on user approval.
- Define the required command/state bridge, security constraints, lifecycle,
  and validation boundaries.
- Preserve no implementation as a valid user option.
- Treat `docs/reference-cosmic-tray-menu.md` as design inspiration only.

Non-goals:

- Implement a tray item, applet, helper, D-Bus service, autostart entry, or
  command/state bridge.
- Treat a Plasma applet as a strict System Tray carrier.
- Reproduce COSMIC styling or controls exactly.
- Use input injection, shell execution, or a broad command interface.
- Change `docs/decisions.md`, source, tests, or existing packaging behavior.

## Applicable Principles and Decisions

- `docs/decisions.md#unified-settings`: tray behavior remains out of scope
  until separately approved.
- `docs/decisions.md#core-distribution`: the current approved distribution is
  the script KPackage plus permitted native effect/KCM packages; an SNI helper
  and autostart artifact are not approved by this decision.
- `docs/decisions.md#native-c-safety-policy`: any new C++ scope requires its
  own approved safety and packaging boundary.

## Constraints

- A strict tray carrier must be an external SNI helper with fixed user-owned
  D-Bus identities.
- The helper must expose only a whitelist of approved actions, validate all
  arguments, avoid shell execution, fail closed when KWin is unavailable, and
  reconnect safely across helper and KWin/script restarts.
- The command/state bridge must be supported and explicitly specify ownership,
  authorization, stale-state behavior, and restart semantics.
- No input injection may substitute for the bridge.
- The initial MVP is one icon, one truthful state indicator, a small whitelist
  of existing actions, and a settings entry point.

## Acceptance Criteria

- [x] The proposal states that the KWin script is not a tray carrier and that
  a strict tray requires an external SNI helper plus a supported bridge.
- [x] The proposal records a minimal Rust SNI MVP, no-implementation option,
  security constraints, and COSMIC-reference limits.
- [ ] The user selects a carrier and approves bridge semantics, settings scope,
  distribution/autostart, and language/native scope.
- [ ] The user authorizes required live Plasma/KWin validation before any live
  work starts.

## Unresolved Questions

- Does the user select no implementation, a Plasma applet, or an external SNI
  helper as the carrier?
- What supported command/state bridge can control and observe the KWin script?
- Which actions and state indicator belong in the minimal MVP?
- Does tray behavior become an approved Unified Settings requirement?
- How is the helper and autostart artifact distributed, installed, updated, and
  removed?
- Is Rust required for the helper, or is further native C++ scope approved?

## Consequential Decisions

- Recommendation: select an external Rust SNI helper only after the user
  approves a supported bridge. It is the smallest route that is truthfully a
  strict tray item while avoiding an expansion of the native C++ boundary.
- Alternative: select no implementation and retain the current KCM/settings
  surface. This is a valid outcome if the bridge, distribution, or lifecycle
  cost is not justified.

Implementation does not begin until the pending user decisions and live
authorization are resolved.
