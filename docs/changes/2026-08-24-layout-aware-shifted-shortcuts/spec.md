# Layout-Aware Shifted Shortcuts

## Intent

Retain the existing hardcoded shifted-digit aliases for the initial release,
which intentionally supports standard US keyboards only. Complete layout
support is deferred until after initial-release completion.

## Proposal Status

This Standard proposal is paused. No implementation, verification, or live work
is authorized until the initial release is complete and separately approved
post-release scope defines complete layout support.

## Scope

- Preserve the existing hardcoded shifted aliases and current source behavior
  for the initial release.
- State that the initial release supports standard US keyboards only.
- Resume this change only after initial-release completion and separate approval
  of complete post-release layout-support scope.

## Non-Goals

- No layout detection, shortcut omission, opt-in configuration, shortcut
  migration, or KGlobalAccel reconciliation for the initial release.
- No source, test, configuration, implementation, verification, or live work
  under this paused change.

## Acceptance Criteria

- The initial release retains the existing hardcoded aliases and explicitly
  documents standard-US-only support.
- No layout detection, shortcut omission, opt-in configuration, migration, or
  reconciliation is introduced for the initial release.
- Complete layout support cannot resume until the initial release is complete and
  its post-release scope is separately approved.

## Pending User Decisions

- Resolved: the initial release supports standard US keyboards only and retains
  the existing hardcoded aliases.
- Resolved: detection, omission, opt-in configuration, migration, and
  reconciliation are not selected for the initial release.
- Pending: after initial-release completion, approve complete layout-support
  scope before this change resumes.
