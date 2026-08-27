# Specification: Install Path Contract Split

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-25 by Orchestrator under autonomous mode. The
  user-approved Core Distribution formal split is active; this record requires
  change-local reconciliation only.
- Commit/push: allowed for this proposal record; Lead owns staging.

## Intent and Desired Outcome

Reconcile this change record to the active formal distinction between the
release-artifact and local dogfood contracts without changing either script's
behavior. The decision records that the paths serve different consumers and
have different mutation boundaries, rather than treating their shared
script-package assembly as grounds to merge them.

## Scope and Non-Goals

In scope:

- Record that `docs/decisions.md#core-distribution` already contains the
  user-approved formal split.
- Keep `scripts/build-kpackage.sh` as the script-only KPackage archive and
  checksum producer, with disposable-root validation and no live KWin action.
- Keep `scripts/dogfood-install.sh` as the local script/native-effect lifecycle
  and `setup` path, including its KWin configuration and D-Bus boundaries.
- Reconcile this change's specification, plan, and log only.

Non-goals:

- Any behavior, interface, output, install location, KWin configuration, or
  D-Bus change.
- Merging the scripts, extracting a shared helper, or changing their tests.
- Selecting native package formats or publication channels.
- Editing `README.md`, `docs/decisions.md`, or the shared dirty
  `docs/backlog.md`.

## Applicable Principles and Decisions

- `docs/decisions.md#core-distribution` retains the script KPackage release
  artifact and permits native-effect and KCM platform-native paths; exact native
  formats and publication remain gated.
- `docs/changes/archive/2026-08-20-simple-install/plan.md` records that these
  paths were deliberately left unreconciled while dogfood gained native-effect
  and `setup` responsibilities.

## Constraints

- `docs/decisions.md` is user-owned and remains unchanged; its active Core
  Distribution wording is the governing evidence.
- No live KWin/Plasma operation is authorized.
- Existing shared script-package logic is a separate maintenance follow-up, not
  a reason to alter these public contracts in this change.
- Backlog closure is a separate protected coordination transaction while
  `docs/backlog.md` remains shared and dirty.

## Acceptance Criteria

- [x] The user-approved Core Distribution wording records the formal split.
- [x] The active decision distinguishes the release artifact's disposable,
      non-live validation boundary from the dogfood path's local KWin
      configuration and D-Bus lifecycle boundary.
- [x] Change-local documentation reconciliation preserves all script command
      contracts and makes no behavioral change.
- [x] Shared plugin-ID and script-member-list drift remains explicitly deferred
      to a separately scoped follow-up.
- [x] The linked backlog entry remains unchanged pending a separate protected
      coordination transaction.

## Unresolved Questions

- None for the approved change-local reconciliation.

## Consequential Decisions

- Recommend a formal split. `scripts/build-kpackage.sh` is a release-artifact
  producer for KDE Store and GitHub Release distribution; `scripts/dogfood-install.sh`
  is a local Plasma dogfood and native-effect lifecycle tool. Their shared
  script-package assembly is real duplication but does not outweigh their
  distinct safety and consumer contracts.

Implementation does not begin until the specification is approved unless
autonomous mode was explicitly requested.
