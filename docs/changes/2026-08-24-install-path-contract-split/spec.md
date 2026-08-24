# Specification: Install Path Contract Split

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-25 by Orchestrator under autonomous mode; the
  user-owned Core Distribution amendment remains pending.
- Commit/push: allowed for this proposal record; Lead owns staging.

## Intent and Desired Outcome

Formally distinguish the release-artifact contract from the local dogfood
contract without changing either script's behavior. The decision records that
the paths serve different consumers and have different mutation boundaries,
rather than treating their shared script-package assembly as grounds to merge
them.

## Scope and Non-Goals

In scope:

- Record the proposed formal split under Core Distribution after the user
  approves its wording.
- Keep `scripts/build-kpackage.sh` as the script-only KPackage archive and
  checksum producer, with disposable-root validation and no live KWin action.
- Keep `scripts/dogfood-install.sh` as the local script/native-effect lifecycle
  and `setup` path, including its KWin configuration and D-Bus boundaries.
- Document the resolved backlog item after the approved documentation change.

Non-goals:

- Any behavior, interface, output, install location, KWin configuration, or
  D-Bus change.
- Merging the scripts, extracting a shared helper, or changing their tests.
- Selecting native package formats or publication channels.

## Applicable Principles and Decisions

- `docs/decisions.md#core-distribution` retains the script KPackage release
  artifact and permits native-effect and KCM platform-native paths; exact native
  formats and publication remain gated.
- `docs/changes/archive/2026-08-20-simple-install/plan.md` records that these
  paths were deliberately left unreconciled while dogfood gained native-effect
  and `setup` responsibilities.

## Constraints

- `docs/decisions.md` is user-owned and cannot be edited until the user approves
  the exact wording below.
- No live KWin/Plasma operation is authorized.
- Existing shared script-package logic is a separate maintenance follow-up, not
  a reason to alter these public contracts in this change.

## Acceptance Criteria

- [ ] The user approves the proposed Core Distribution wording for the formal
      split.
- [ ] The approved decision distinguishes the release artifact's disposable,
      non-live validation boundary from the dogfood path's local KWin
      configuration and D-Bus lifecycle boundary.
- [ ] Documentation changes preserve all existing script command contracts and
      make no behavioral change.
- [ ] The linked backlog item is resolved only after the approved documentation
      change and evidence are complete.
- [ ] Shared plugin-ID and script-member-list drift remains explicitly deferred
      to a separately scoped follow-up.

## Unresolved Questions

- Does the user approve the Core Distribution wording recorded in `plan.md`?

## Consequential Decisions

- Recommend a formal split. `scripts/build-kpackage.sh` is a release-artifact
  producer for KDE Store and GitHub Release distribution; `scripts/dogfood-install.sh`
  is a local Plasma dogfood and native-effect lifecycle tool. Their shared
  script-package assembly is real duplication but does not outweigh their
  distinct safety and consumer contracts.

Implementation does not begin until the specification is approved unless
autonomous mode was explicitly requested.
