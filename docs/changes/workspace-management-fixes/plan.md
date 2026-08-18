# Plan: Workspace Management Fixes

Ownership and approval:
- Owner: Lead
- Status: Diagnosis and spec drafted 2026-08-18 by Lead. Implementation units
  below are not yet dispatched; they need Orchestrator approval, and Units 1
  and 3a specifically need answers before any code is written (spec.md
  Unresolved Questions Q1, Q2).

## Technical Approach

Bug 1 and Bug 2 are independent defects with independent root causes (spec.md).
Each has a blocking pre-implementation question that must be answered before
its fix is designed, so the plan sequences a small decision/repro unit ahead
of each fix unit rather than starting implementation directly. The two bugs'
units can run in parallel with each other (no shared file scope conflict
expected beyond both touching `controller.ts`, which the review unit checks).

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification |
|---|---|---|---|---|
| 1 | Bug 1 live repro gate: with the user's participation, press `Meta+Shift+1` (or another digit) once on the live host while tailing `journalctl --user _PID=<current kwin pid>` for `plasma-auto-tiler:workspace-move-invoked`. Record whether it fires. | - | none (read-only diagnosis) | A dated, PID-scoped journal excerpt showing either the diagnostic firing or a clean bounded window with no firing, captured immediately around the user's confirmed key press. |
| 2 | Bug 1 fix, contingent on Unit 1: if reproduced, design and implement a fix for the identified delivery gap (or document why none is possible and escalate as a platform limitation per spec.md); if not reproduced, close Bug 1 as already-working and update `docs/backlog.md` status via the Orchestrator (this Lead does not edit backlog.md itself). | 1 | `kwin/src/controller.ts`, `kwin/src/entry.ts` if the fix requires a different registration surface, `kwin/tests/controller.test.ts` | Focused unit tests for the fix; `npm --prefix kwin run typecheck`; live acceptance per spec.md acceptance criteria (`workspace-move-invoked` plus the resulting desktop membership change observed live for `Meta+Shift+1` and `Meta+Shift+0`). |
| 3 | Bug 2 decision gate: obtain explicit Orchestrator/user ruling on spec.md Q2 (`Meta+0`/`Meta+Shift+0` strict create-on-demand vs. a narrow reserved-spare exception to the corrected rule). | - | none (decision only) | Ruling recorded verbatim in this plan's Progress/Pending section and reflected in spec.md before Unit 4 starts. |
| 4 | Bug 2 fix: change the removal-eligibility predicate in `planDesktopCleanup` (and any of the `removeOwnedEmpty*`/`trailingOwnedEmptyId` call sites the Unit 3 ruling requires) so eligibility is empty-and-invisible-on-every-output, independent of `ownedIds`, in all three workspace modes; implement whichever `Meta+0`/`Meta+Shift+0` behavior Unit 3 ruled on. | 3 | `kwin/src/logic.ts` (`planDesktopCleanup`), `kwin/src/controller.ts` (cleanup/trailing-empty call sites), `kwin/tests/logic.test.ts`, `kwin/tests/controller.test.ts` | Focused unit tests per spec.md acceptance criteria (unowned empty invisible desktop removed; owned empty invisible desktop still removed; visible-on-any-output desktop preserved in every mode; last-global-desktop floor preserved; occupancy/sticky semantics unchanged); `npm --prefix kwin run typecheck`; full `npm --prefix kwin test`. |
| 5 | Bug 2 live acceptance: on the user's host, observe that switching between desktops 1 and 2 a few times converges to no further empty invisible desktops accumulating, without destroying any window, output, or desktop the user is actively using. | 4 | none (live observation only) | Journal shows `workspace-cleanup-removed` firing for eligible desktops across observed switches; a read-only desktop-count/visibility check before and after shows only empty, invisible desktops were removed. |
| 6 | Independent review of both fixes together: re-read the diffs, confirm no regression in the existing owned-desktop and occupied/sticky/multi-output test coverage, confirm the shipped bundle rebuilds reproducibly. | 2, 4 | Change scope | Review findings recorded in `log.md`; `npm --prefix kwin run build` run twice produces identical `main.js` SHA-256; `git diff --check` clean. |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Progress

- [x] Diagnosis stint: root cause established for both bugs, spec.md drafted,
  plan.md and log.md created. No implementation units dispatched yet.
- [ ] Unit 1 - Bug 1 live repro gate
- [ ] Unit 2 - Bug 1 fix
- [ ] Unit 3 - Bug 2 decision gate (Q2)
- [ ] Unit 4 - Bug 2 fix
- [ ] Unit 5 - Bug 2 live acceptance
- [ ] Unit 6 - Independent review

## Pending User/Orchestrator Decisions

- spec.md Q1: is Bug 1 actually reproducing live right now, or did the report
  predate the current KWin session? (Gates Unit 2's design; Unit 1 answers
  this.)
- spec.md Q2: `Meta+0`/`Meta+Shift+0` strict create-on-demand vs. a narrow
  reserved-spare exception once the ownership-based cleanup rule is removed.
  (Gates Unit 4's exact implementation.)

## Acceptance-Criterion Evidence

Not yet applicable; no implementation units have executed.

## Residual Risks

- Bug 1's fix cannot be scoped until Unit 1 answers whether it reproduces
  live; if it is a genuine Wayland/KWin global-shortcut delivery limitation
  for this modifier combination rather than a script defect, Unit 2 may need
  to escalate rather than ship a fix (spec.md says this plainly; do not force
  a fix onto a platform limitation).
- Bug 2's live acceptance (Unit 5) must not destroy the user's real,
  currently-in-use desktops 1 and 2 or any window on them; only empty,
  invisible desktops (3-12, or whatever remains empty and invisible at
  execution time) are cleanup targets.
- Both fixes touch `controller.ts`; Unit 6 exists specifically to catch any
  interaction between the two changes before they are considered complete.

## Final Outcome

Not yet applicable; this document currently records only the diagnosis-stint
plan for a future implementation stint.
