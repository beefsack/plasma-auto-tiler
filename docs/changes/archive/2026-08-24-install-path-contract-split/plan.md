# Plan: Install Path Contract Split

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-25 by Orchestrator under autonomous mode; Core
  Distribution wording is decision-resolved. This approved pre-start split
  limits the remaining unit to change-local documentation reconciliation.
- Commit/push: allowed for this proposal record; Lead owns staging.

## Technical Approach

Use a change-local documentation-only reconciliation. The active
`docs/decisions.md#core-distribution` wording already records the formal split;
do not edit it, the README, or the shared dirty backlog. Do not change either
script or its tests. The retained release path builds the script-only archive
and checksum, validates only in disposable roots, and does not install, enable,
configure, or reconfigure a live KWin session. The retained dogfood path
manages local script and native-effect installation, `setup`, KWin
configuration, and documented D-Bus lifecycle operations.

The common plugin ID, `npm` build, four script members, metadata validation, and
tool checks are drift risks. Their consolidation is excluded and requires a
separate scoped follow-up.

## Work Units

| ID | Objective | Depends on | Scope | Verification |
|---|---|---|---|---|
| unit-01 | Obtain user approval of the exact Core Distribution formal-split wording. | - | User-owned `docs/decisions.md#core-distribution` decision only. | `D-01` |
| unit-02 | Reconcile this change-local record to the already-active decision. | unit-01 | This change's `spec.md`, `plan.md`, and `log.md` only. Do not edit `docs/decisions.md`, README, scripts, tests, or `docs/backlog.md`. | `D-01`, `D-02` |
| unit-03 | Establish focused script-contract baselines before any separately approved implementation that changes either script or its tests. | unit-02 | Static test commands only; no live KWin/Plasma operation. | `G-01`, `G-02` |

## Gate Evidence Map

| ID | Type | Literal canonical command or observation | Baseline / expected result |
|---|---|---|---|
| D-01 | static | Inspect `docs/decisions.md#core-distribution`. | Active user-approved wording records the split; no decision edit occurs. |
| D-02 | static | `git diff --check -- docs/changes/2026-08-24-install-path-contract-split/spec.md docs/changes/2026-08-24-install-path-contract-split/plan.md docs/changes/2026-08-24-install-path-contract-split/log.md` | No whitespace errors in the three approved change-local artifacts; source snapshot is `HEAD` plus their scoped uncommitted diff. |
| G-01 | static | `bash scripts/build-kpackage.test.sh` | Baseline establishment required before future script/test implementation; not run for this proposal. |
| G-02 | static | `bash scripts/dogfood-install.test.sh` | Baseline establishment required before future script/test implementation; not run for this proposal. |

`G-01` and `G-02` are recorded contract gates, not required evidence for the
documentation-only proposal commit. Their current baselines must be established
before a future implementation touches the corresponding script or tests.

## Progress

- [x] unit-01 - accepted: Core Distribution wording decision resolved.
- [x] unit-02 - accepted: change-local record reconciled to the active decision;
  backlog coordination remains excluded.
- [ ] unit-03 - deferred: no script/test implementation is in this change.

## Attempt Accounting

- No implementation dispatches or corrections have occurred.
- Change-wide ledger: 0 implementation dispatches, 0 dispatch-invalids, 0
  pre-review corrections, 0 finding-fix corrections, 0 independent reviews, 0
  changed-kind resets, 0 broad gate runs, 1 acceptance criterion moved, and 0
  no-progress streak.

## Startup VCS Policy

- Agent commits: yes, after accepted units or for this approved proposal record.
- Agent pushes: yes, after accepted units or for this approved proposal record.
- Staging owner: Lead.
- User commit required: no.
- Candidate preservation container: none authorized or required.
- Manifest and cleanup owner: not applicable.

## Decision Record

- Resolved: `scripts/build-kpackage.sh` exclusively owns non-mutating,
  script-only release archive and checksum construction and validation in
  disposable roots without mutating a live KWin session. `scripts/dogfood-install.sh`
  owns local script/native-effect installation, setup, configuration, and the
  documented D-Bus lifecycle; it is not a release-artifact publisher. Shared
  script-package assembly duplication remains a separate maintenance concern.

## Acceptance-Criterion Evidence

| Acceptance criterion | Gate ID | Literal canonical command or observation | Expected baseline | Evidence |
|---|---|---|---|---|
| User-approved formal split is active. | `D-01` | Inspect `docs/decisions.md#core-distribution`. | Exact split wording is active; no decision edit. | active decision scope records the split |
| Decision records the distinct safety and mutation boundaries. | `D-01` | Inspect `docs/decisions.md#core-distribution`. | Release validation is disposable/non-live; dogfood owns local configuration and D-Bus lifecycle. | active decision scope records both boundaries |
| Change-local documentation preserves existing contracts without behavioral change. | `D-02` | `git diff --check -- docs/changes/2026-08-24-install-path-contract-split/spec.md docs/changes/2026-08-24-install-path-contract-split/plan.md docs/changes/2026-08-24-install-path-contract-split/log.md` | No whitespace errors; only the three approved change-local artifacts differ from `HEAD`. | passed on `HEAD` plus the scoped uncommitted documentation diff |
| Shared logic remains a separately scoped follow-up. | `D-01` | Inspect active Core Distribution wording and change record. | No helper or script change in this change. | active decision and scoped diff confirm deferral |
| Backlog coordination remains protected. | `D-02` | Inspect approved scope and repository ownership. | `docs/backlog.md` is not modified by this unit. | deferred to separate coordination |

## Residual Risks

- `PLUGIN_ID` is derived from metadata by the release script and hardcoded by
  the dogfood script.
- The four script members are declared independently in the release script and
  two dogfood paths. A future member-set change can drift until its tests catch
  it.
- No script or test implementation is authorized by this record.

## Final Outcome

- Core Distribution wording is active and this change-local record is accepted.
  Completion archived this record and removed its exact one-line backlog entry;
  no script or test implementation has occurred.
