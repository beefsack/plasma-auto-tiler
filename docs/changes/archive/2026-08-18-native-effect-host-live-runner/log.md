# Log: Native Effect Host Validation

Append-only checkpoint record.

## 2026-08-18 00:29 +1000

- Role / unit: Lead / doc-reset / prior committed checkpoint
- Result: accepted
- Files / commit: `7064f47`
- Verification: inspected the committed diff against `82c497c`; `git diff --check` passed.
- Notes: the reset replaces the generalized runner with the approved five-phase, one-off current-host protocol.

## 2026-08-18 00:29 +1000

- Role / unit: Lead / implementation / implementation/attempt-01
- Result: dispatched
- Files / commit: none
- Verification: brief reconciled to the frozen acceptance matrix, active decision, and live-testing exception.
- Notes: static/fake work only; host mutation and both session boundaries remain user-run.

## 2026-08-18 00:29 +1000

- Role / unit: Lead / implementation / implementation/attempt-01
- Result: accepted
- Files / commit: `scripts/live-native-effect-test.sh`, `scripts/live-native-effect.test.sh`
- Verification: inspected actual diff; `bash -n`, focused fake suite (40 checks), and `git diff --check` passed in Worker evidence.
- Notes: retained user-run evidence covers the two boundaries, `/Effects` lifecycle, restoration, and postflight. Independent review is required before commit.

## 2026-08-18 00:29 +1000

- Role / unit: Worker / independent-review / independent-review/attempt-01
- Result: findings returned
- Files / commit: `scripts/live-native-effect-test.sh`, `scripts/live-native-effect.test.sh`
- Verification: independent static/fake review reproduced symlink-parent staging and a leftover created namespace parent.
- Notes: one bounded same-scope correction is authorized; no live action occurred.

## 2026-08-18 00:29 +1000

- Role / unit: Worker / implementation / implementation/attempt-01/correction-01
- Result: accepted
- Files / commit: `scripts/live-native-effect-test.sh`, `scripts/live-native-effect.test.sh`
- Verification: inspected correction diff; focused fake suite passed 43 checks and the review confirmation verified both prior findings.
- Notes: correction budget is exhausted. No live action occurred.

## 2026-08-18 00:29 +1000

- Role / unit: Worker / independent-review / independent-review/attempt-01 confirmation
- Result: accepted
- Files / commit: none
- Verification: confirmed the namespace-symlink refusal and exact created-namespace restoration only.
- Notes: this confirmation was not a second independent review.

## 2026-08-18 00:29 +1000

- Role / unit: Lead / implementation and independent-review / commit
- Result: committed
- Files / commit: `dc7cacb`
- Verification: accepted static/fake evidence, review dispositions, and `git diff --check` were inspected before commit.
- Notes: user-run live attempt remains pending; no host action occurred.

## 2026-08-18 09:34 +1000

- Role / unit: Lead / worktree reconciliation
- Result: discarded
- Files / commit: none (worktree only)
- Verification: inspected `git status --short`; restored `docs/changes/native-effect-host-live-runner/{log,plan,spec,state}.md`, `scripts/live-native-effect-test.sh`, and `scripts/live-native-effect.test.sh` to `HEAD` (`6664192`); confirmed the resulting worktree was clean apart from the three pre-existing untracked paths (`CMakeFiles/`, `Project Technical Report and Implementation Plan.md`, `test-output`), none created by the discarded work.
- Notes: unaccepted, unstaged reset-work modifications from a prior session were discarded per direct user authorization; frozen acceptance for the five-phase protocol at `6664192` was unaffected, since the discard only reverted uncommitted changes.

## 2026-08-18 09:34 +1000

- Role / unit: Lead / doc-checklist / doc-checklist/attempt-01
- Result: dispatched
- Files / commit: none
- Verification: brief reconciled to the Orchestrator-approved simplification direction (replace the five-phase evidence machine and fake-host suite with a short current-machine-only checklist), with exact drafted `spec.md`/`plan.md` content supplied verbatim.
- Notes: documentation and deletion only; no host action authorized.

## 2026-08-18 09:34 +1000

- Role / unit: Lead / doc-checklist / doc-checklist/attempt-01
- Result: accepted
- Files / commit: `docs/changes/native-effect-host-live-runner/spec.md`, `docs/changes/native-effect-host-live-runner/plan.md`, `scripts/live-native-effect-test.sh` (removed), `scripts/live-native-effect.test.sh` (removed)
- Verification: inspected the actual diff directly (not a summary) and confirmed it matched the supplied drafts exactly; confirmed `git status --short`/`git diff --stat` touched only the four intended files; confirmed via repository-wide search that no in-scope file retains a dangling reference to the removed scripts; Worker's `bash -n` sanity check of the checklist's shell fragments passed.
- Notes: the five-phase protocol, its implementation, and its independent review
  are superseded and removed. The prior failed pre-boundary user attempt (recovered by a user-run script) and the removed implementation's accepted history are recorded in `plan.md` History. `user-attempt` remains pending and user-run only; nothing was committed.

## 2026-08-18 (Lead / Unit F of host-dogfooding / archive)

- Role / unit: Lead / F / attempt-1
- Result: accepted. Directory moved from
  `docs/changes/native-effect-host-live-runner/` to
  `docs/changes/archive/2026-08-18-native-effect-host-live-runner/` via
  `git mv` (four files: `spec.md`, `plan.md`, `state.md`, `log.md`).
- Files / commit: the four files above (staged rename only, per Unit F's
  file-move exception to the no-stage constraint; not committed).
- Verification: confirmed no other in-repo file references the old
  non-archived path except `docs/backlog.md` (reconciled separately under
  Unit G) and two out-of-scope files reported to the Orchestrator/user
  (`docs/live-kwin-testing.md` line 54, `docs/changes/native-active-border-configuration/spec.md`
  line 112 - both dangling links to the pre-archive path, left unedited as
  outside this Lead's file scope).
- Notes: corrected one factual error in `spec.md` step 4 (the checklist
  incorrectly said to omit the plugin-name argument for `supportInformation`;
  per `org.kde.kwin.Effects.xml` it takes exactly one string argument, same
  as every other method there) and appended an honest outcome record to
  `plan.md` ("Final Outcome (Archived 2026-08-18)") and `state.md`: the
  five-phase runner and this checklist are both abandoned as
  over-engineering (no defect in either), the one real host attempt (nonce
  `host-20260818-7f3c9a2d`) was stopped at an evidence-completeness gate
  before user boundary 1 - not a defect - and was fully rolled back, its
  external evidence at `/tmp/plasma-auto-tiler-host-20260818-7f3c9a2d` is
  referenced only (not moved/copied/modified/deleted), and this change is
  superseded by `docs/changes/host-dogfooding/` under the new
  standing-authorization policy. No ABI pin evidence or lessons/attempt-
  history content was deleted.
