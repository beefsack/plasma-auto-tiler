# Specification: Installer Dry Run

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-15 by Orchestrator

## Intent and Desired Outcome

Add a strictly read-only `dry-run` command to `scripts/dogfood-install.sh` so a
developer can inspect whether the source package is suitable for installation,
whether its KCM assets are present, and whether the local KWin installation is
present and enabled before running a mutating install workflow.

## Scope and Non-Goals

In scope:

- Report source bundle/package metadata validity.
- Report required KCM schema and UI presence.
- Report destination install state and enabled state using the existing
  `kreadconfig6` status convention.
- Describe intended install actions without performing them.
- Add hermetic shell coverage and concise root README command documentation.

Non-goals:

- Building, copying, configuration writes, KWin reconfiguration, or shortcut
  reconciliation from `dry-run`.
- Effect packaging, release-channel changes, apply-mode changes, shortcut
  migration, uninstall changes, or any live operation.

## Constraints

- `dry-run` must fail closed when required read tools or data are unavailable.
- It must not invoke build, copy, write-config, D-Bus reconfigure, or shortcut
  reconciliation paths.
- Reuse the existing `kreadconfig6` status dependency and injection convention.
- Tests must use temporary roots and fake read tools, without accessing host
  Plasma configuration or a live KWin session.
- Do not edit generated `kwin/contents/code/main.js`.

## Acceptance Criteria

- [ ] `dry-run` reports source bundle/package metadata validity and required KCM
  schema/UI presence.
- [ ] `dry-run` reports destination install state and enabled state through the
  existing `kreadconfig6` convention.
- [ ] `dry-run` lists intended install actions while performing no build, copy,
  configuration write, KWin reconfigure, or shortcut reconciliation.
- [ ] Missing required read tools or required source data produce an actionable
  failure before an incomplete report is treated as successful.
- [ ] Hermetic shell tests cover successful reporting, missing read tools/data,
  and absence of mutation; README documents the command concisely.

## Unresolved Questions

- None. Distribution and shortcut-migration policy remain out of scope.
