# Plan: Installer Dry Run

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-15 by Orchestrator

## Technical Approach

Extend the existing shell management interface with one inspection-only command.
It will validate the source inputs the installer depends on, reuse the injected
`kreadconfig6` read path to obtain enabled state, inspect the destination, and
print the install steps it would take. The command has no mutating command
calls, and hermetic fakes will prove the boundary.

## Work Units

| ID | Objective | Depends on | File scope | Verification |
|---|---|---|---|---|
| installer-dry-run-01 | Implement `dry-run`, hermetic tests, and README documentation. | - | `scripts/dogfood-install.sh`, its shell test, `README.md`, directly necessary usage output | Focused shell test and `git diff --check`; broader installer test if required by the focused test layout. |

## Progress

- [x] installer-dry-run-01/attempt-01: accepted after one hermetic-test correction.

## Pending User Decisions

- Distribution/release-channel behavior and shortcut migration are parked as
  out of scope.

## Acceptance-Criterion Evidence

| Acceptance criterion | Reproducible evidence | Result |
|---|---|---|
| Source metadata and KCM assets are reported | `bash scripts/dogfood-install.test.sh` | 156 passes, 0 failures: valid metadata, bundle, schema, and UI reporting; missing source and invalid/mismatched metadata failures. |
| Destination and enabled state are reported | `bash scripts/dogfood-install.test.sh` | 156 passes, 0 failures: absent/present destination and fake-`kreadconfig6` disabled/enabled reporting. |
| No dry-run mutation occurs | `bash scripts/dogfood-install.test.sh` | 156 passes, 0 failures: fake tool log contains no npm, write-config, or D-Bus invocation; temporary config/data roots remain unchanged. |
| Read dependency/data failures fail closed | `bash scripts/dogfood-install.test.sh` | 156 passes, 0 failures: missing `jq`/`kreadconfig6`, missing source data, invalid/mismatched metadata, and read failure return errors. |
| Documentation and shell hygiene | README review; `git diff --check` | README matches command behavior; `git diff --check` exit 0. |

## Residual Risks

- Hermetic tests prove command selection and isolated filesystem behavior, not
  host Plasma state. Live invocation is excluded.

## Final Outcome

- `installer-dry-run-01` is accepted. The command is inspection-only and no
  distribution, release-channel, apply-mode, shortcut-migration, uninstall, or
  live-operation behavior changed.
