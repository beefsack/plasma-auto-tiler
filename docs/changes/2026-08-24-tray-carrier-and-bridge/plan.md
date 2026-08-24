# Plan: Tray Carrier and Command/State Bridge

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-25 by Autonomous Orchestrator; all architecture,
  distribution, settings, bridge, and dogfood authorization decisions are
  resolved, while implementation remains open.

## Technical Approach

This is an Expanded documentation-only route because a tray carrier crosses
KWin, session D-Bus, resident-process, autostart, distribution, security, and
live-host boundaries. The recommended implementation, if approved, is an
external Rust SNI helper plus a separately proven supported command/state bridge
to the KWin script. The script does not own the tray item. A Plasma applet is a
possible panel control but is not automatically a strict System Tray item.

The minimum useful MVP is one SNI icon, one truthful state indicator, a small
whitelist of existing actions, and a settings entry point. The helper uses fixed
user-owned D-Bus identities, validates inputs, performs no shell execution or
input injection, fails closed when KWin is unavailable, and reconnects safely.
COSMIC menu structure is inspiration only; its workspace behavior, active hint,
exact icon, styling, and dynamic shortcut display are not requirements.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Gate ID and literal canonical command (static or live) | Expected baseline |
|---|---|---|---|---|---|
| unit-01 | Obtain user decisions on carrier, bridge semantics, Unified Settings scope, distribution/autostart, and language/native scope; retain no implementation as an option. | - | `docs/decisions.md`, product governance | `gate.user-governance`: user-approved written decisions | Decisions resolved and recorded. |
| unit-02 | Prove and specify a supported command/state bridge with ownership, authorization, state synchronization, reconnect, and failure semantics. | unit-01 | KWin script and approved bridge surface | `gate.bridge-static`: command selected after unit-01 | Approved semantics recorded; implementation not started. |
| unit-03 | Implement the minimal Rust SNI helper, D-Bus menu, icon, whitelist, and fail-closed behavior. | unit-02 | New helper package only | `gate.sni-static`: command selected with the approved helper toolchain | Implementation not started. |
| unit-04 | Define and implement approved distribution, installation, autostart, update, and removal contracts. | unit-01, unit-03 | Approved packaging and installer boundary | `gate.package-static`: command selected after distribution approval | Implementation not started. |
| unit-05 | Run user-authorized live validation of registration, rendering, actions, state synchronization, restart recovery, and removal. | unit-02, unit-03, unit-04 | User Plasma/KWin session | `gate.sni-live`: user-authorized live observation | Parked pending implementation and user-run live observation. |

## Progress

- [x] unit-01 proposal decisions are resolved and recorded.
- [ ] unit-02 open: bridge proof and specification.
- [ ] unit-03 blocked on unit-02.
- [ ] unit-04 blocked on unit-01 and unit-03.
- [ ] unit-05 blocked on units 02-04 and user live authorization.

## Attempt Accounting

No implementation units have started.

| Unit | Implementation attempts | Pre-review corrections | Finding-fix corrections | Independent reviews |
|---|---:|---:|---:|---:|
| no entries | 0 | 0 | 0 | 0 |

### Change-Wide Ledger

| Implementation dispatches | Dispatch-invalids | Pre-review corrections | Finding-fix corrections | Independent reviews | Changed-kind resets | Broad gate runs | Worker tool-call proxy | Lead tool-call proxy | Acceptance criteria moved | No-progress streak |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |

## Startup VCS Policy

- Autonomous mode: enabled for durable proposal artifacts only; it does not approve governance or implementation.
- Agent commits: yes, after accepted documentation scope.
- Agent pushes: yes, after accepted documentation scope.
- Staging owner: Lead.
- User commit required: no.
- Candidate preservation container: none.
- Manifest and cleanup owner: not applicable; no rejected work is preserved.

## Pending User Decisions

- Resolved: use a portable Rust StatusNotifierItem helper, with the KWin backend
  first; fail closed without a watcher.
- Resolved: use a proof-first fixed D-Bus bridge with a whitelist, outbound state
  snapshots, reconnect and idempotence, and no shell or input injection.
- Resolved: KCM remains the sole settings owner; tray behavior is limited to
  state, approved actions, and open-settings.
- Resolved: development is dogfood-only; before release the helper becomes
  official core, while the tiler remains functional without it.
- Resolved: standing authorization covers reversible, namespaced user-local
  helper build, stage, start, and stop operations, its graphical-session
  autostart entry, and session D-Bus; non-project state is prohibited.
- Resolved: the implementation is Rust-only, with no additional native C++
  scope selected.
- Resolved: live validation remains user-run and requires explicit applicable
  authorization before execution.

## Acceptance-Criterion Evidence

| Acceptance criterion | Gate ID | Literal canonical command or observation | Expected baseline | Evidence |
|---|---|---|---|---|
| KWin script carrier limitation and strict SNI requirement are recorded. | `gate.proposal-inspection` | Inspect `spec.md` and `plan.md`. | Recorded without source changes. | `spec.md` Technical Approach and Constraints; `plan.md` Technical Approach. |
| MVP, security boundaries, no-implementation option, and COSMIC limits are recorded. | `gate.proposal-inspection` | Inspect `spec.md` and `plan.md`. | Recorded without implementation claims. | `spec.md` Scope, Constraints, and Consequential Decisions. |
| User governance decisions are explicit before implementation. | `gate.user-governance` | User-approved written decisions. | Resolved. | `plan.md` Pending User Decisions. |
| Live validation remains user-authorized. | `gate.sni-live` | User-authorized live observation. | Pending. | `plan.md` unit-05. |

## Residual Risks

- No supported inbound command/state bridge is currently established; an SNI
  helper without it could present stale state or non-functional actions.
- The resident helper and autostart artifact remain implementation work under
  the resolved Core Distribution boundary.
- A tray interface can imply immediate workspace behavior that current Unified
  Settings explicitly excludes.
- Static evidence cannot establish panel/tray rendering, watcher lifecycle, or
  restart behavior; these remain live-host risks.

## Final Outcome

- Governance is resolved. Implementation remains open pending the bridge proof,
  helper work, distribution work, and user-run live authorization.
