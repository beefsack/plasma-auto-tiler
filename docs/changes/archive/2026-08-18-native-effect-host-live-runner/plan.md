# Plan: Native Effect Host Validation

Ownership and approval:
- Owner: Lead
- Status: Simplified to a one-off checklist, 2026-08-18.
- Scope: the checklist in `spec.md`.

## History

- The generalized runner's state and preflight units (commits `1f87d47`
  through `82c497c`), together with their associated evidence, were
  discarded before the five-phase protocol (below) was written. Their fake
  assertion totals were never accepted progress.
- The five-phase protocol and its `scripts/live-native-effect-test.sh` /
  `scripts/live-native-effect.test.sh` implementation (`dc7cacb`, doc commit
  `6664192`) were accepted after one same-scope correction round and one
  independent review (see the prior Attempt and Review Counts below). That
  implementation is now superseded and removed by this simplification: the
  Orchestrator-approved direction replaces the multi-phase persistent
  evidence machine and its fake-host test suite with the short checklist in
  `spec.md`, run directly by the user. No defect in the removed
  implementation drove this change.
- The user then ran one live attempt against the accepted five-phase
  protocol (nonce `host-20260818-7f3c9a2d`). Read-only pin verification and
  the plugin build/stage both completed and verified clean (build log,
  staged-artifact SHA-256 hashes, and owned-path manifest all recorded) - the
  attempt was stopped before user boundary 1 at an evidence-completeness
  gate, not by a build or staging defect, and was fully recovered by a
  user-run recovery script: the exact nonce entry, staged plugin, staged
  directories, and previously absent namespace root it created were
  removed; the pre-existing Home Manager symlink was verified unchanged.
  Evidence and a recovery transcript are retained outside this repository at
  `/tmp/plasma-auto-tiler-host-20260818-7f3c9a2d` (referenced only; not
  moved, copied, or modified by this archive). The attempt was recovered but
  never accepted; boundary 1 never occurred and no acceptance evidence was
  produced.
- That failed attempt counts against the `user-attempt` unit. This
  simplification is an approach change under the breaker rules (not a retry
  of the same design), so the `user-attempt` counter resets to zero attempts
  under the new checklist-based protocol; the failed attempt and its
  recovery remain recorded above rather than discarded from history.

The accepted exact host pin is unchanged:

- `out=/nix/store/kfacyll1bnh89q9aqbs54qjgda2c4hkm-kwin-6.7.3`
- `dev=/nix/store/483vmk08g6bjaa3bvf3abn10cwpw6ap9-kwin-6.7.3-dev`
- shared derivation:
  `/nix/store/ak2wg58bdpv0q7z3n5pjz6gj6s18bxm9-kwin-6.7.3.drv`

## Work Units

| ID | Objective | Scope and verification |
|---|---|---|
| doc-checklist | Replace the five-phase evidence-machine spec/plan with the approved one-off checklist and explicit user-run commands; remove the superseded scripts. | Documentation and deletion only. Verify against the retained safety properties (pin verification, user-only mutation/boundaries, nonce-owned staging, `/Effects` lifecycle, exact restoration, scoped postflight, stop-on-surprise) and confirm no other file references the removed scripts. No implementation or host action. |
| user-attempt | The trusted single user performs the checklist once, including both session boundaries and manual visual observation. | User-run evidence covers the acceptance checklist in `spec.md`. Agents provide no host mutation and perform no session boundary. |

## Circuit Breaker

The plan permits at most one `doc-checklist` Worker and one same-scope
correction round. Any repeated same-semantic finding, correction-limit
breach, no-progress retry, or increasing verification volume without
milestone movement stops the work and reports:

- accepted state
- discarded work
- blocker
- available options
- recommended reset

## Protocol Rules

The checklist in `spec.md` is followed exactly, in order: read-only pin
verification; exact plugin and temporary `environment.d` staging; user
boundary 1; exact `/Effects` support, load, manual visual, unload, and
unloaded validation; and exact restoration with user boundary 2 and scoped
postflight verification.

The trusted single user runs every command serially and alone, owns host
mutation, and performs both session boundaries. On an unexpected or
ambiguous result, the attempt stops; evidence and nonce-owned paths remain,
the exact plugin state is queried, and manual recovery is discussed and
completed before removal. Broad cleanup is never used.

The prohibitions are `sudo`, system plugin paths, `/Compositor`,
`/Scripting`, automatic primary-session mutation, routine in-place KWin
termination, broad cleanup, unrelated state changes, and agent-executed host
mutation.

## Execution Record

| Unit | Status | Evidence |
|---|---|---|
| doc-checklist | pending | Not yet dispatched. |
| user-attempt | pending | User-run only, after `doc-checklist` acceptance. One prior attempt against the now-superseded five-phase protocol failed before boundary 1 and was fully recovered (see History); its counter resets under this approach change. |

## Acceptance-Evidence Map

| Acceptance items | Evidence | Status |
|---|---|---|
| 1-8 | User-run checklist evidence per `spec.md`, collected during the `user-attempt` unit. | pending |

## Residual Risks

- The checklist has no automated evidence capture: acceptance rests on the
  user directly observing each command's output against `spec.md`.
- Crash/power-loss rollback and hostile same-user races are explicitly out
  of scope.

## Review Findings

None yet under the simplified checklist. The two findings against the
removed five-phase implementation (symlinked namespace-parent staging;
leftover namespace parent after restoration) were fixed and confirmation-
verified before that implementation was superseded; the checklist's step 2
namespace note and step 5 exact-removal wording carry those lessons forward
in plain-language form.

## Attempt and Review Counts

| Unit | Attempts | Corrections | Independent reviews |
|---|---:|---:|---:|
| doc-checklist | 0 | 0 | 0 |
| user-attempt | 0 (reset; see History) | 0 | 0 |

Prior counts against the removed five-phase `implementation` unit
(1 attempt, 1 correction, 1 independent review, all accepted) are preserved
in git history at `dc7cacb` and are no longer live counters for this plan.

## Outcome

- The five-phase protocol, its implementation, and its independent review
  are superseded and removed by this simplification.
- `doc-checklist` and `user-attempt` are both pending. `user-attempt` is the
  sole source of live acceptance evidence and is not authorized for agents.

## Pending User Decisions

- None.

## Final Outcome (Archived 2026-08-18)

- This change is archived under
  `docs/changes/archive/2026-08-18-native-effect-host-live-runner/` and
  superseded by `docs/changes/host-dogfooding/`, which delivers a simple
  repeatable dogfood path for both the KWin script and the native effect
  under a new standing-authorization policy for reversible, user-local
  operations (see `docs/decisions.md#native-effect-live-validation`).
- Both the original five-phase persistent-evidence runner/fake-host test
  suite (removed by `doc-checklist`) and this simplified one-off checklist
  are abandoned as over-engineering relative to the standing-authorization
  approach; neither was defective, and neither reached user-run live
  acceptance (`user-attempt` never ran to completion - see History).
- The sole real host attempt (nonce `host-20260818-7f3c9a2d`, against the
  five-phase protocol) is not a validation failure: pin verification, build,
  and staging all completed and verified clean; the attempt was stopped
  before user boundary 1 at an evidence-completeness gate and was fully
  rolled back by a user-run recovery script (see History). Its evidence is
  retained, referenced only, at
  `/tmp/plasma-auto-tiler-host-20260818-7f3c9a2d`.
- The accepted host ABI/development pin evidence recorded above
  (`kwin-6.7.3` out/dev outputs, shared `.drv`) and the review lessons
  folded into the checklist (namespace-symlink refusal, exact
  created-namespace restoration, lowercase `org.kde.kwin.Effects`) remain
  valid background context and are preserved unchanged in this archive.
- `docs/changes/host-dogfooding/` Unit B independently re-derived and
  re-verified a live native-effect dogfood path (`effect-install`,
  `effect-status`, `effect-reload`, `effect-remove` in
  `scripts/dogfood-install.sh`) rather than resuming this checklist;
  `effect-reload`/`effect-remove` and observed border rendering remain
  unverified on the host pending the user's one-time logout/login, same as
  this change's unresolved `user-attempt` gate.
