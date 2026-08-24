# Plan: Install Path Contract Split

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-25 by Orchestrator under autonomous mode; execution
  is parked on the user-owned Core Distribution decision.
- Commit/push: allowed for this proposal record; Lead owns staging.

## Technical Approach

Use a documentation-only formal split. After user approval, add the approved
wording to `docs/decisions.md#core-distribution`, then align the README command
contracts and close the linked backlog item. Do not change either script or its
tests. The retained release path builds the script-only archive and checksum,
validates only in disposable roots, and does not install, enable, configure, or
reconfigure a live KWin session. The retained dogfood path manages local script
and native-effect installation, `setup`, KWin configuration, and documented
D-Bus lifecycle operations.

The common plugin ID, `npm` build, four script members, metadata validation, and
tool checks are drift risks. Their consolidation is excluded and requires a
separate scoped follow-up.

## Work Units

| ID | Objective | Depends on | Scope | Verification |
|---|---|---|---|---|
| unit-01 | Obtain user approval of the exact Core Distribution formal-split wording. | - | User-owned `docs/decisions.md#core-distribution` decision only. | `D-01` |
| unit-02 | Delegate the approved decision and command-contract documentation update, then resolve the linked backlog entry. | unit-01 | `docs/decisions.md`, README command-contract sections, this change record, and the linked backlog entry only. | `D-01`, `D-02` |
| unit-03 | Establish focused script-contract baselines before any separately approved implementation that changes either script or its tests. | unit-02 | Static test commands only; no live KWin/Plasma operation. | `G-01`, `G-02` |

## Gate Evidence Map

| ID | Type | Literal canonical command or observation | Baseline / expected result |
|---|---|---|---|
| D-01 | static | User approval of the exact Pending User Decisions wording below. | Approved wording recorded before a delegated `docs/decisions.md` edit. |
| D-02 | static | `git diff --check` | No whitespace errors; diff is limited to the approved documentation and backlog scope. |
| G-01 | static | `bash scripts/build-kpackage.test.sh` | Baseline establishment required before future script/test implementation; not run for this proposal. |
| G-02 | static | `bash scripts/dogfood-install.test.sh` | Baseline establishment required before future script/test implementation; not run for this proposal. |

`G-01` and `G-02` are recorded contract gates, not required evidence for the
documentation-only proposal commit. Their current baselines must be established
before a future implementation touches the corresponding script or tests.

## Progress

- [ ] unit-01 - parked: pending user decision.
- [ ] unit-02 - blocked by unit-01.
- [ ] unit-03 - deferred: no script/test implementation is in this change.

## Attempt Accounting

- No implementation dispatches or corrections have occurred.
- Change-wide ledger: 0 implementation dispatches, 0 dispatch-invalids, 0
  pre-review corrections, 0 finding-fix corrections, 0 independent reviews, 0
  changed-kind resets, 0 broad gate runs, 0 acceptance criteria moved, and 0
  no-progress streak.

## Startup VCS Policy

- Agent commits: yes, after accepted units or for this approved proposal record.
- Agent pushes: yes, after accepted units or for this approved proposal record.
- Staging owner: Lead.
- User commit required: no.
- Candidate preservation container: none authorized or required.
- Manifest and cleanup owner: not applicable.

## Pending User Decisions

- Approve or revise this addition to `docs/decisions.md#core-distribution`:
  "Release artifact construction and local dogfood installation are separate
  contracts. `scripts/build-kpackage.sh` produces and validates the script-only
  KPackage archive and checksum in disposable roots without mutating a live KWin
  session. `scripts/dogfood-install.sh` manages the local script and native-effect
  dogfood lifecycle, including `setup`, KWin configuration, and its documented
  D-Bus operations; it is not a release-artifact publisher. Shared
  script-package assembly logic remains a separate maintenance concern and does
  not merge these contracts."

## Acceptance-Criterion Evidence

| Acceptance criterion | Gate ID | Literal canonical command or observation | Expected baseline | Evidence |
|---|---|---|---|---|
| User approves the formal split wording. | `D-01` | User approval of the Pending User Decisions text. | Approval before decision edit. | Pending. |
| Decision records the distinct safety and mutation boundaries. | `D-01` | Inspect approved `docs/decisions.md#core-distribution` diff. | Exact approved text only. | Blocked. |
| Documentation preserves existing contracts without behavioral change. | `D-02` | `git diff --check` and scoped diff inspection. | No whitespace errors; no script/test changes. | Blocked. |
| Backlog item is resolved with evidence. | `D-02` | Inspect linked backlog and change-record diff. | One linked entry reflects accepted completion. | Blocked. |
| Shared logic remains a separately scoped follow-up. | `D-01` | Inspect approved Core Distribution wording and change record. | No helper or script change in this change. | Pending. |

## Residual Risks

- `PLUGIN_ID` is derived from metadata by the release script and hardcoded by
  the dogfood script.
- The four script members are declared independently in the release script and
  two dogfood paths. A future member-set change can drift until its tests catch
  it.
- The user may reject or revise the proposed wording; all decision and
  documentation editing remains parked until then.

## Final Outcome

- Proposal created and backlog item paused. No implementation or documentation
  decision editing has occurred.
