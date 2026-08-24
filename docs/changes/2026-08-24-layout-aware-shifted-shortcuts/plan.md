# Layout-Aware Shifted Shortcuts Plan

## Scope

This Standard proposal is limited to layout-aware registration of the existing
move-to-workspace shifted aliases. Prospective source scope is
`kwin/src/controller-config.ts`, `kwin/src/controller.ts`,
`kwin/src/kwin-globals.d.ts`, and the existing controller and artifact-smoke
fixtures. No implementation is authorized while the pending user decisions
remain unresolved.

## Approach

The approved technical recommendation is an asynchronous startup/reload query of
`org.kde.keyboard` at `/Layouts`, followed by pure resolver-based registration.
The resolver returns a complete supported mapping or no layout-sensitive rows.
Stable action IDs are preserved. The plan makes no dynamic-layout claim because
the current `Script.callDBus()` boundary cannot subscribe to KDE's layout-change
signals. A reload-only contract or a separately supported signal bridge requires
user selection.

## Units

| Stable ID | Dependency | Scope | Classification | Progress | Attempts | Corrections | Reviews | Breaker |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| `unit-01` | Decision resolved | Add the pure layout resolver, asynchronous startup/reload query, fail-closed registration, and deterministic D-Bus fixture seam. | Static implementation | Open | 0 | 0 | 0 | 0 |
| `unit-02` | `unit-01` | Run focused resolver/controller tests and required static gates; record resulting baselines. | Static verification | Blocked | 0 | 0 | 0 | 0 |
| `unit-03` | User-run live ownership and selected contract | Validate approved layouts, collision avoidance, unavailable service, and reload or signal-bridge behavior on a live host. | Live acceptance | Parked | 0 | 0 | 0 | 0 |

## Static Gates

| Gate ID | Command | Purpose | Current baseline |
| --- | --- | --- | --- |
| `G1` | `npm --prefix kwin run typecheck` | Typecheck source and test boundaries. | Scope evidence recorded a pass; do not treat it as post-change evidence. |
| `G2` | `npm --prefix kwin test` | Full controller and fixture regression suite. | Scope evidence recorded 994 passing and 0 failing tests; do not treat it as post-change evidence. |
| `G3` | `git diff --check` | Whitespace validation for the implementation diff. | Not run for this documentation-only proposal. |

## Live Gates

| Gate ID | Observation | Status |
| --- | --- | --- |
| `L1` | Physical move-alias delivery and `Meta+<digit>` collision avoidance on each approved layout/variant. | Parked pending implementation and live ownership. |
| `L2` | Layout change followed by the selected reload-only or supported signal-bridge contract. | Reload-only policy resolved; parked pending implementation and live ownership. |
| `L3` | Unknown or unavailable keyboard service omits only move aliases and preserves unrelated shortcuts. | Fail-closed policy resolved; parked pending implementation and live ownership. |

## Acceptance-Evidence Map

| Acceptance criterion | Evidence |
| --- | --- |
| Supported identity resolves to complete aliases only | Focused pure-resolver fixtures for every approved layout/variant. |
| Unknown identity fails closed | Focused resolver fixtures proving no move rows. |
| Asynchronous ordering and reply failures are safe | Controller fixtures for success, malformed reply, D-Bus error, and lost callback. |
| IDs and migration policy remain stable | Existing shortcut-catalog assertions plus diff inspection. |
| Static quality | `G1`, `G2`, and `G3` after implementation. |
| Physical layout correctness and dynamic contract | `L1`, `L2`, and `L3`; separate live evidence only. |

## Pending User Decisions

- Resolved: exact US registers the existing shifted aliases.
- Resolved: non-US, unknown, unavailable, or malformed layout state omits only
  layout-sensitive move aliases and preserves unrelated shortcuts.
- Resolved: layout changes require reload; no dynamic subscription contract is
  selected.
- Resolved: agents may snapshot, reconcile, and roll back only this project's
  affected KGlobalAccel records; non-project mutation requires separate
  approval.

## Stop Conditions

- Any proposed shortcut migration-policy change.
- Any host-specific layout exception.
- Any claim that startup querying observes an in-session layout change.
- Any attempt to infer an unapproved variant representation from the D-Bus tuple.
- Any live operation without separately applicable authorization.

## Initial State

- `agent_commits`: allowed by user.
- `agent_pushes`: allowed by user.
- `staging_owner`: Lead stages only approved proposal paths.
- `user_commit_required`: false.
- `candidate_preservation`: none; no implementation candidate exists.
- `cleanup_owner`: Lead.
- No implementation dispatch, correction, review, gate run, or live operation has
  occurred for this change.
