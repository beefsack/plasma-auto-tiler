# Layout-Aware Shifted Shortcuts Plan

## Scope

This Standard proposal is paused until the initial release is complete and
separately approved post-release scope defines complete layout support. The
initial release intentionally supports standard US keyboards only and preserves
the existing hardcoded shifted aliases. No source, test, configuration,
implementation, verification, or live work is authorized by this plan.

## Approach

No complete-layout implementation approach is selected. Detection, shortcut
omission, opt-in configuration, migration, and reconciliation are not selected
for the initial release. A separately approved post-release scope must define
the supported layout behavior, tasks, acceptance criteria, and verification
before work resumes.

## Units

| Stable ID | Dependency | Scope | Classification | Progress | Attempts | Corrections | Reviews | Breaker |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| None | Initial-release completion and separately approved post-release complete-layout scope | No implementation, verification, or live task is authorized while paused. | Deferred planning | Paused | 0 | 0 | 0 | 0 |

## Current Ledger

All values are current as of 2026-08-27. No source, test, configuration,
implementation, verification, or live work for this change has been dispatched
or accepted.

| Counter | Value |
| --- | ---: |
| Implementation dispatches | 0 |
| Semantic attempts | 0 |
| `dispatch-invalid` results | 0 |
| Pre-review implementation corrections | 0 |
| Finding-fix corrections | 0 |
| Verification/harness repairs | 0 |
| Independent source reviews | 0 |
| Independent documentation reviews | 1 |
| Changed-kind resets | 0 |
| Broad-gate runs | 0 |
| Worker tool-call proxy | 0 |
| Lead tool-call proxy | 0 |
| Acceptance criteria moved | 0 |
| No-progress streak | 0 |

## Acceptance-Evidence Map

| Acceptance criterion | Evidence |
| --- | --- |
| Initial-release policy remains documentation-only | This scoped reconciliation changes only approved documentation paths; no source, test, or configuration evidence exists or is claimed. |
| Complete layout support remains deferred | The decision, backlog, specification, and plan record initial-release completion and separately approved post-release scope as prerequisites. |
| Governance consistency | One independent read-only documentation review found no findings. |

## Pending User Decisions

- Resolved: the initial release supports standard US keyboards only and preserves
  the existing hardcoded aliases.
- Resolved: detection, shortcut omission, opt-in configuration, migration, and
  reconciliation are not selected for the initial release.
- Pending: after initial-release completion, separately approve complete
  layout-support scope before defining resumed work.

## Stop Conditions

- Any source, test, or configuration change before post-release scope is
  separately approved.
- Any initial-release layout detection, shortcut omission, opt-in configuration,
  migration, or reconciliation.
- Any implementation, verification, or live claim while this change is paused.

## Initial State

- `agent_commits`: allowed by user.
- `agent_pushes`: allowed by user.
- `staging_owner`: Lead stages only approved proposal paths.
- `user_commit_required`: false.
- `candidate_preservation`: none; no implementation candidate exists.
- `cleanup_owner`: Lead.
- No implementation dispatch, correction, source review, gate run, or live
  operation has occurred for this change.
