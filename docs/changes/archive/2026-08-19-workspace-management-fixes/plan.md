# Plan: Workspace Management Fixes

Ownership and approval:
- Owner: Lead
- Status: Diagnosis and spec drafted 2026-08-18 by Lead. Q1 and Q2 answered by
  the user the same day (spec.md "User rulings"). Units 1-2 (Bug 1) executed
  and complete same day, done by the Lead directly (no worker-anthropic
  dispatch used this stint). **2026-08-18 Bug 2 ruling stint:** Q2 confirmed
  unconditional and extended with a replenish-loop removal requirement; a
  worker-anthropic code survey ran read-only to size the change; the former
  single Unit 4 (fix) / 5 (live accept) / 6 (review) breakdown was replaced
  with Units 4-10 below (shared predicate, then one unit per `workspaceMode`,
  then reconciliation, live acceptance, and review) because the survey found
  roughly 45-50 existing tests reference the model being replaced. **2026-08-18
  Q5-Q7 ruling stint:** all three ambiguities resolved by the user (spec.md
  "User rulings"); Unit 4 dispatched to `worker-anthropic` and accepted
  (shared predicate + broadened removal trigger). Units 5-10 next.

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
| 4 | Bug 2 shared foundation: change `planDesktopCleanup`'s removal-eligibility predicate (`kwin/src/logic.ts`) to drop `ownedIds` and `protectedTrailingIds` gating (empty-and-invisible-on-every-output only, last-desktop floor unchanged); update the switch-cleanup call site (`kwin/src/controller.ts` `cleanupAfterWorkspaceSwitch`) to stop supplying ownership/protected-trailing data for eligibility; broaden the removal *trigger* per Q5/Q7 so the general `cleanupDesktops()` dispatcher (window add/remove, move, float, drag finish, `desktopsChanged`, reconstruction settle, output disconnect) also removes eligible empty/invisible desktops immediately, not only `cleanupAfterWorkspaceSwitch`, and so output disconnect is evaluated against the post-disconnect connected-output set with no grace period. Update the generic (mode-independent) `logic.test.ts` `planDesktopCleanup` unit tests and the generic `controller.test.ts` "TileController dynamic virtual desktops" cleanup-eligibility tests (survey: ~11 tests). Does not yet touch per-mode replenish deletion or `Meta+0`/`Meta+Shift+0` create-on-demand behavior - those are Units 5-7. | 3 | `kwin/src/logic.ts`, `kwin/src/controller.ts` (`cleanupDesktops` dispatcher and switch-cleanup call site), `kwin/tests/logic.test.ts`, `kwin/tests/controller.test.ts` (generic cleanup-eligibility block only) | Focused tests per spec.md Bug 2 "Cleanup eligibility", "Removal trigger scope" (Q7), and "Output disconnect" (Q5) acceptance criteria; `npm --prefix kwin run typecheck`; `npm --prefix kwin test -- logic.test` and the touched `controller.test.ts` describe block green. |
| 5 | **Amended 2026-08-19 (Lead succession 2, mid-unit discovery, recorded below in Progress): units 5-7 are no longer independently implementable and are merged into this one unit.** Worker investigation (unit-05 attempt-1) proved that per-mode replenish removal and per-mode `Meta+0`/`Meta+Shift+0` always-create are not separable across modes: (a) all three modes' `removeOwnedEmpty*` functions share one `position === lastIndex` guard that is only safe while some reconcile function still protects one "kept" trailing desktop; (b) `reconcileLocalWorkspaces`/`reconcileGlobalUnique`/the shared reconcile fragment all independently implement the same reserved-capacity "trim to one kept" pattern Q6 already rejected, and removing it from only one mode leaves the other two modes' still-reuse-based `Meta+0`/`Meta+Shift+0` logic assuming a guarantee reconcile no longer provides, breaking their previously-passing tests. Combined scope: remove the replenish (auto-create) and trim-to-one-kept (reserved-capacity) logic from all three reconcile paths, relying solely on `cleanupEligibleDesktops` -> `planDesktopCleanup`'s own last-global-desktop floor as the sole removal authority in every mode; remove the now-redundant `position === lastIndex` guard from all three `removeOwnedEmpty*` functions; change `Meta+0`/`Meta+Shift+0` handling to always create-and-switch / create-and-move in all three modes, never reusing an existing empty desktop. Update `controller.test.ts`'s per-output-local, global-unique, shared, legacy "TileController dynamic virtual desktops", and "workspace mode and per-output seams (Unit 04)" blocks together (survey: original ~28 tests across the three mode blocks, plus an additional ~13 legacy/Unit-04-block tests discovered live to depend on the same reserved-capacity model - not in the original survey). | 4 | `kwin/src/controller.ts` (`reconcileLocalWorkspaces`, `reconcileGlobalUnique`, shared reconcile fragment, all three `removeOwnedEmpty*` functions, `Meta+0`/`Meta+Shift+0` paths for all three modes), `kwin/tests/controller.test.ts` (per-output-local, global-unique, shared, legacy dynamic-virtual-desktops, and Unit-04-seam blocks) | Focused tests per spec.md Bug 2 "Replenish-loop removal" and "Create-on-demand" acceptance criteria, identically in all three `workspaceMode` values; `npm --prefix kwin run typecheck`; `npm --prefix kwin test -- controller.test` green across all five touched blocks. |
| 6 | **Superseded 2026-08-19: merged into Unit 5 above** (see Unit 5's amendment note - global-unique's reconcile-removal and `Meta+0`/`Meta+Shift+0` changes are not separable from Units 5/7 and are implemented together). No separate dispatch. | 4, 5 | (merged into Unit 5) | (merged into Unit 5) |
| 7 | **Superseded 2026-08-19: merged into Unit 5 above** (see Unit 5's amendment note - shared mode's reconcile-removal and `Meta+0`/`Meta+Shift+0` changes are not separable from Units 5/6 and are implemented together). No separate dispatch. | 4, 5 | (merged into Unit 5) | (merged into Unit 5) |
| 8 | **Accepted 2026-08-19 (Lead succession 5), attempt-1, 0 corrections.** Bug 2 full-suite reconciliation: fresh content-based sweep of `controller.test.ts`/`logic.test.ts` for any remaining removed-model reference (found none - old plan.md line numbers 12530/12539/12967/14499 were stale and discarded per state.md); fixed two stale "replenish" doc comments (`appendDesktopForOutputKey`, `appendDesktopForGlobalUnique`); removed two now-unreachable `already-trailing-empty` no-op branches (`finishSharedWorkspaceZero`, `focusTrailingEmpty`) after confirming unreachability, plus cascading removal of the now-unused `currentDesktopIdForOutput`/`currentDesktopIdGlobal` helpers and the unused `output` param of `finishSharedWorkspaceZero`; typecheck clean, full suite 802/802 pass + smoke 271/271, build run twice identical SHA-256 `ab6ad59d43a0317835fd101bc71893e46585a35b23307d74180bf931b0af9735`. | 5, 6, 7 | `kwin/tests/controller.test.ts`, `kwin/tests/logic.test.ts`, `kwin/src/controller.ts` (doc comments and the two confirmed-dead branches plus their direct cascading cleanup only), build output | `npm --prefix kwin run typecheck`; full `npm --prefix kwin test`; `npm --prefix kwin run build` run twice produces identical `main.js` SHA-256. |
| 9 | **Accepted 2026-08-19 (Lead succession 9), attempt-2, 0 corrections.** Bug 2 live acceptance: on the user's host, confirmed (a) enabling the plugin's startup sweep removes none of the 4 real, user-confirmed-populated desktops; (b) a freshly created, never-switched-to, empty desktop is auto-removed by the live cleanup path with no replenish. See "Acceptance-Criterion Evidence" below for full detail. | 8 | none (live observation only) | Journal shows `workspace-cleanup-removed` firing and no subsequent `workspace-cleanup-replenished`; a read-only desktop-count/visibility check before and after shows only the throwaway empty invisible desktop was affected; the user's desktops 1/2 and windows are unchanged. |
| 10 | **Accepted 2026-08-19 (Lead succession 10), attempt-1, 0 corrections.** Independent review of the full Bug 2 diff (Units 4-8) together: re-read the diffs across all three modes, confirm no regression in occupied/sticky/visible-on-any-output protection, confirm no cross-mode leakage, confirm the shipped bundle rebuilds reproducibly. | 8 | Change scope (Bug 2 portion) | Review findings recorded in `log.md`; `git diff --check` clean. |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Progress

- [x] Diagnosis stint: root cause established for both bugs, spec.md drafted,
  plan.md and log.md created. No implementation units dispatched yet.
- [x] Unit 1 - Bug 1 live repro gate: satisfied by the user's own re-test
  (Q1 answered directly, no fresh agent-side repro needed).
- [x] Unit 2 - Bug 1 fix: shifted-symbol compatibility-alias rows added for
  `move-workspace-1..9` and `move-workspace-0`; live-registered and confirmed
  correct via `allShortcutInfos`; full "window actually moves" live proof
  blocked by a newly discovered, pre-existing KGlobalAccel residue collision
  (spec.md "New finding"), escalated rather than resolved.
- [x] Unit 3 - Bug 2 decision gate (Q2): answered by the user (spec.md "User
  rulings"), confirmed unconditional (no reserved-spare reuse) and extended
  with the replenish-loop removal requirement during this ruling stint
  (2026-08-18); recorded in spec.md "Consequential decision ... resolved" and
  the rewritten Bug 2 acceptance criteria. Units 4-10 below (spec/plan-only,
  not yet dispatched) replace the former single Unit 4/5/6 breakdown to keep
  each Worker's scope to one axis (shared predicate, or one `workspaceMode`)
  given the survey found ~45-50 tests across `controller.test.ts` reference
  the model being replaced.
- [x] Unit 4 - Bug 2 shared foundation (cleanup predicate): `planDesktopCleanup`
  (logic.ts) drops `ownedIds`/`protectedTrailingIds`; `cleanupAfterWorkspaceSwitch`
  renamed `cleanupEligibleDesktops` and now runs unconditionally on every
  `cleanupDesktops()` branch (Q7 broadened trigger; Q5 output-disconnect
  removal is a consequence, since `handleScreensChanged` already routes
  through `cleanupDesktops`); dead `protectedTrailingIdsForSwitchCleanup`/
  `trailingOwnedEmptyId` deleted; `switchCleanup` param removed. One
  same-scope correction round (stale doc comment). Accepted 2026-08-18.
- [x] Unit 5 (amended, absorbs Units 6-7) - Bug 2 all three modes, reconcile
  removal-logic unification + create-on-demand - **accepted in full
  2026-08-19 (Lead succession 4). Source-change half accepted 2026-08-19
  (Lead succession 3); test-update half dispatched and accepted this stint
  (attempt-1, 0 corrections) after this succession confirmed via a fresh
  full-suite run that the prior succession's cancellation had not silently
  advanced it (all five target blocks still failing pre-dispatch, matching
  state.md's account exactly).** After the investigation/plan-restructure recorded below,
  a fresh `worker-anthropic` (single dispatch, `kwin/src/controller.ts` only)
  implemented the full consolidated brief in one pass with zero corrections:
  all three reconcile paths reduced to mapping-rebuild only (no
  creation/removal/reserved-capacity logic); the `position === lastIndex`
  guard and its parameter removed from all three `removeOwnedEmpty*`
  functions; `Meta+0`/`Meta+Shift+0` converted to always-create (never reuse)
  in `global-unique` and `shared` (matching `per-output-local`'s already-
  converted pattern) across all four call-site groups
  (`finishWorkspaceZero`/`finishSharedWorkspaceZero`/`moveActiveToWorkspace`/
  `finishMoveToTrailing`); four now-dead helper methods deleted
  (`trailingOwnedEmptyForGlobalUnique`, `trailingOwnedEmptiesInSubset`,
  `trailingOwnedEmptyDesktop`, `appendDesktopForGlobalUniqueKey`); stale doc
  comments updated. Lead-verified directly (not just Worker-reported): full
  diff read line-by-line, `npm --prefix kwin run typecheck` clean (both
  configs), and a direct grep confirms zero remaining occurrences of
  `workspace-cleanup-replenished`, `trailingOwnedEmpty`, `protectedTrailingIds`,
  `switchCleanup`, `position === lastIndex`, or `ownedIds` as a
  `planDesktopCleanup` argument anywhere in `controller.ts`. No test file
  touched by this dispatch (by design - test updates are a separate,
  already-specified next dispatch, `state.md`). Full evidence in this
  section's "Acceptance-Criterion Evidence" entry below and in `state.md`.
- [x] Unit 6 - superseded, merged into Unit 5 (2026-08-19).
- [x] Unit 7 - superseded, merged into Unit 5 (2026-08-19).
- [ ] Unit 8 - Bug 2 full-suite reconciliation - not started (note: the
  unit-05 test-half Worker already ran a full-suite pass as a side effect and
  reported 802/802 tests, 271/271 shell-smoke pass; Lead independently
  reproduced this exact count directly. Unit 8 should treat this as a strong
  prior, not a substitute for its own reconciliation of the borderline-case
  survey and the flagged residuals below.)
- [x] Unit 9 - Bug 2 live acceptance - **accepted 2026-08-19 (Lead succession
  9), attempt-2, 0 corrections.** See "Acceptance-Criterion Evidence" below.
- [x] Unit 10 - Independent review of the full Bug 2 diff - **accepted
  2026-08-19 (Lead succession 10), attempt-1, 0 corrections.** See
  "Acceptance-Criterion Evidence" below. (Bug 1's diff has no independent
  second-party review either; still open, tracked as a residual risk below.)

## Pending User/Orchestrator Decisions

- spec.md Q1 and Q2: both answered by the user 2026-08-18 (see spec.md "User
  rulings"). No longer pending.
- spec.md Q4 - who/what owns the `move-and-switch-to-desktop-*` /
  `move-to-last-desktop` KGlobalAccel residue in `~/.config/kglobalshortcutsrc`,
  and is it safe to clear? Needed before Bug 1's alias shortcuts can be proven
  to actually win the physical key on this host (they are registered
  correctly today but are shadowed by this residue's lower registration-order
  tie-break). Still open.
- **Resolved (2026-08-18, Q5-Q7 ruling stint):** spec.md Q5, Q6, Q7 all
  answered by the user. Q5: remove immediately on output disconnect, no grace
  period. Q6: always create new, never reuse, even transiently. Q7: broaden
  removal to fire on every `cleanupDesktops()` dispatcher event (window
  close/remove, move, float, drag finish), not only workspace switch. See
  spec.md "User rulings". Units 4-10 proceed on these rulings; Unit 4's scope
  is amended to include broadening the dispatcher removal trigger (Q7) as
  shared foundation work, since every mode-specific unit depends on it.
- **Resolved (2026-08-19, Lead succession 8):** the Desktop 2 incident below
  is resolved - code exonerated, standing blocker cleared. See log.md's
  2026-08-19 succession-8 entry and state.md for full evidence and ruling.
  **New, narrow, open question relayed to the Orchestrator/user this
  succession, not yet answered at handover:** does Desktop 3 (`ec13f70f...`),
  Desktop 4 (`41cee7be...`), or "4" (`dd68d41e...`) currently hold any
  windows? Needed as the fresh occupancy baseline the added live-test
  procedure requires (state.md "Next action") before unit-09 attempt-2
  enables the plugin.
- **2026-08-19 (Lead succession 6), historical - unit-09 live attempt-1
  stopped on a live-safety trigger, escalated - now resolved above.** With
  the user's explicit
  authorization to enable the rebuilt (unit-08) bundle live, disable+enable
  forced a genuine reload (the first `enable` alone, config already `true`,
  did not reload the running script - a real operational finding for future
  live attempts: toggle-to-force-reload, not a plain re-`enable`, is required
  when the config value is unchanged). Startup `cleanupDesktops()` removed 10
  desktops total (0 `workspace-cleanup-replenished`, confirming the no-replenish
  half of Q5-Q7 held). Before: 13 desktops
  (`392a73ad`=Desktop 1, `83e443a3`=Desktop 2, plus 11 more). After: 3
  desktops (`392a73ad` Desktop 1, `ec13f70f` Desktop 3, `41cee7be` Desktop 4).
  **Desktop 2 (`83e443a3-b84a-417c-b5d1-02199836953d`) was removed.** An
  earlier Lead succession's dispatch brief (inherited, not independently
  re-verified by this Lead immediately before this stint's mutation) recorded
  desktops 1 and 2 as the user's populated desktops. This Lead did not
  re-capture per-desktop window occupancy (read-only, non-personal-data) as
  its own fresh baseline before enabling - a process gap - so it cannot
  currently distinguish "desktop 2 was still populated and got wrongly
  removed (real defect)" from "desktop 2 had since become empty (the user
  closed those windows since the last check) and removal was correct". The
  script was disabled immediately on observing the missing desktop (within
  the same read-only check that discovered it); the visible desktop
  (`392a73ad`, Desktop 1) never changed throughout. No manual desktop
  creation, window move, or visible-desktop switch was performed by this
  Lead. `bash scripts/dogfood-install.sh status` confirms `enabled: no`
  post-disable. This is escalated per the explicit stop-condition in this
  Lead's dispatch brief rather than continued or retried. See log.md for the
  full evidence and open question.
- **Documentation drift, not a Unit-4-9 blocker, needs its own follow-up:**
  `docs/roadmap.md` lines 172-186 and 220-222 describe the pre-ruling design
  ("Meta+0 focuses or creates the mode-defined trailing empty", "automatic
  trailing-empty maintenance per mode", "switch-only cleanup"). `docs/backlog.md`
  lines 22-25 describe the same pre-ruling design in the P2 entries for this
  change's own prerequisite spikes/features. Neither was edited this stint
  (out of this stint's authorization); both will read as stale once Units 4-9
  ship and should be updated as part of this change's eventual completion
  transaction. No conflict found in `docs/decisions.md` itself - it has no
  clause describing the trailing-empty/reserved-spare design.

## Acceptance-Criterion Evidence

Bug 2 (Unit 10, independent review), 2026-08-19 (Lead succession 10) -
`worker-anthropic`, attempt-1, 0 corrections. **Note on this stint's entry
point:** this succession found `state.md` already describing a "unit-10
accepted" outcome and an already-applied observability fix (see below), but
`log.md` has no succession-9 or succession-10 entry and `plan.md` had no
Unit-10 evidence recorded - i.e. no inspectable Worker report existed
anywhere for the claimed prior review, consistent with a quota-cancelled
session whose tool calls persisted to disk but whose final report/bookkeeping
did not. This Lead treated the claim as unverified and dispatched a genuine
fresh `worker-anthropic` (this entry) rather than accept it on narrative
alone, per this stint's explicit brief.
- Verdict: accept-with-non-blocking-findings. All spec.md Bug 2 acceptance
  criteria checked and passing: cleanup eligibility (ownership-independent,
  visible-on-any-output preserved, protected-trailing exemption removed,
  last-global floor preserved, occupancy semantics unchanged), replenish-loop
  removal (zero `workspace-cleanup-replenished` anywhere), removal trigger
  scope (Q7, fires on every `cleanupDesktops()` dispatch), output disconnect
  (Q5, immediate, post-disconnect connected-output set), create-on-demand
  (Meta+0/Meta+Shift+0 always create, symmetric across all three
  `workspaceMode` values), no cross-mode asymmetry, no dead
  ownership/reserved-trailing code remnants, no test weakened without valid
  reason.
- **This Lead independently re-verified the substance directly, not just the
  report** (per the standing "inspect findings against the actual diff"
  instruction): re-ran `npm --prefix kwin run typecheck` (clean),
  `npm --prefix kwin run test` (802/802 pass, 271/271 smoke), `git diff
  --check` (clean), and `npm --prefix kwin run build` (SHA-256
  `8ee1eabb52d16c656aa022c36801b2f39543ab4c3445f849116708b2c6a3d18a`, matching
  the Worker's own two identical runs) - all reproduced exactly. Directly
  grepped `kwin/src` for `workspace-cleanup-replenished`, `trailingOwnedEmpty`,
  `protectedTrailingIds`, `ownedIds\b`: zero hits, confirming the report's
  "no dead code" claim. Directly confirmed `orderedIds.length <= 1` floor at
  `kwin/src/logic.ts:850` (not lines 1035-1059 as the report cited - **the
  report's line citation for this claim was wrong**, though the underlying
  claim itself is correct); directly confirmed `reconcileLocalWorkspaces`/
  `reconcileGlobalUnique` at `controller.ts:8285`/`8654` do mapping-rebuild
  only; directly confirmed all three `removeOwnedEmpty*` functions gate on
  `visible.has(id)` at `controller.ts:8247,8377,8709`; directly confirmed the
  doubled deferred-diagnostic-count assertions (finding 1) are real, at
  `controller.test.ts:12579,12590,12630,12641` (**not lines 1371-1401 as the
  report cited - also wrong**). **Assessment: two of the report's line
  citations were inaccurate (off by ~185 lines in one file, ~11,200 lines in
  another), but every substantive technical claim independently reproduced
  exactly as described once checked at its real location** - a review-quality
  defect in citation precision, not a code defect, and not grounds to reject
  or redispatch given the underlying findings are all independently
  confirmed.
- Findings (all non-blocking, cosmetic): 7 stale doc-comment locations
  describing the removed ownership/reserved-trailing-empty model
  (`controller.ts` a shortcut-settings-visible string at line 615, "Focus or
  create the trailing empty workspace" - the most consequential since it is
  user-visible in KDE's shortcut settings UI - plus six internal doc
  comments at approximately lines 4286, 4374, 7543, 8368, 8460, 2023,
  spot-checked and confirmed present); one duplicated-diagnostic-read
  inefficiency (`cleanupDesktops()`/`cleanupEligibleDesktops()` each
  independently re-read `visibleDesktopIds()`/`occupiedDesktopIds()`,
  doubling API calls and duplicate deferred-diagnostic log lines per pass,
  confirmed harmless functionally). **Decision: recorded as a single
  follow-up backlog item (see `docs/backlog.md`), not fixed this stint** -
  consistent with the precedent already set for the two stale comments
  flagged by units 8/10's earlier work (left as residual, not fixed), and
  per the Orchestrator's explicit instruction to avoid expanding this
  change's scope given the imminent COSMIC-style trailing-empty-workspace
  rework that will touch this same code again shortly.
- Live acceptance criterion (manual removal stays removed under real
  switching) was correctly out of scope for a code-only review; already
  covered by Unit 9's live acceptance evidence above.

Bug 2 (Unit 9, live acceptance), 2026-08-19 (Lead succession 9) -
`worker-anthropic`, attempt-2, 0 corrections:
- Precondition satisfied: the user confirmed directly (relayed via the
  Orchestrator) that all four currently-existing desktops (`392a73ad` Desktop
  1 visible, `ec13f70f` Desktop 3, `41cee7be` Desktop 4, `dd68d41e` "4") hold
  windows. No unpopulated real desktop existed to accidentally exercise the
  removal path against.
- Pre-dispatch baseline (this Lead, direct, immediately before dispatch):
  `bash scripts/start-test.sh desktops` and a raw `current` property read
  matched the above exactly; `dogfood-install.sh status` showed
  `installed: yes, enabled: no`.
- Sweep-safety AC (enabling the plugin removes none of the 4 real,
  populated desktops): Worker enabled the plugin, re-read desktops/current
  immediately after (all 4 present, `current` unchanged) and reported zero
  `workspace-cleanup-removed` events in the post-cursor journal window for
  that phase. **Lead independently re-verified this directly** via a fresh
  `journalctl --user _PID=23049` read spanning the whole test window: the
  08:30:20 startup epoch (`shortcut-registered`, `startup-handlers-ready`,
  `ownership-taken`) shows zero `workspace-cleanup-removed` entries before the
  next phase.
- Auto-removal AC (a freshly created, never-switched-to, empty desktop is
  removed with no replenish): Worker created one throwaway desktop via a
  direct `VirtualDesktopManager.createDesktop` D-Bus call (never switching
  `current` to it), then observed it gone from a subsequent `desktops` read
  with the 4 originals and `current` (`392a73ad...`) intact throughout. The
  Worker's own intermediate "confirm exactly 5 desktops" checkpoint could not
  be captured (the live cleanup path removed the throwaway faster than the
  Worker's follow-up poll), so it correctly stopped rather than forcing the
  checkpoint, per its stop-and-report instruction - not a hard-stop safety
  incident (no real desktop or `current` was ever touched). **Lead judgment:
  this timing gap does not leave the AC unproven** - the before/after ID diff
  (4 desktops both times, with a `workspace-cleanup-removed` event in between
  and no unexplained surviving fifth desktop) is conclusive on its own, and
  the Lead independently confirmed via direct journal read exactly one
  `workspace-cleanup-removed` event at 08:30:36 (16s after the startup epoch,
  consistent with the Worker's `createDesktop` timing) and zero
  `workspace-cleanup-replenished` anywhere in the entire captured window.
  Redispatching solely to force-observe the transient 5-desktop state was
  judged unnecessary re-verification of an already-met criterion, not a
  second attempt on an unmet one.
- Zero replenish AC: confirmed independently by both the Worker's journal
  read and this Lead's own direct `journalctl` read - zero
  `workspace-cleanup-replenished` occurrences anywhere across the entire
  test.
- Baseline restoration: Worker restored `enabled: no` (the state found at
  Step 0) at the end. **Lead independently re-verified directly, post-task**:
  `start-test.sh desktops` shows exactly the original 4 rows in the same
  order, raw `current` read is `392a73ad-0fff-4b48-bb91-1b67eb82bc49`,
  `dogfood-install.sh status` shows `installed: yes, enabled: no` - byte-for-
  byte identical to the Step 0 baseline.
- **Deliberately not attempted (Lead scoping decision, not a gap)**:
  live-reproving "an empty desktop is preserved while visible" was excluded
  from this attempt's scope, since doing so would require switching the
  current/visible desktop away from the user's Desktop 1 while he is actively
  working - a direct conflict with the standing "never switch his visible
  desktop" live constraint. This specific behavioral rule is already covered
  by accepted unit-level evidence (spec.md Verification criteria: "an empty
  desktop visible on any output is preserved", satisfied under units 4/5/8).
  `Meta+0`/`Meta+Shift+0` create-on-demand live proof also remains out of
  scope (needs a physical keypress per the standing constraint; not attempted
  this stint, matching the already-recorded state.md position).

Bug 2 (Unit 5, source-change half only), 2026-08-19 - `worker-anthropic`,
attempt-1, 0 corrections:
- Replenish-loop removal AC: `reconcileLocalWorkspaces`, `reconcileGlobalUnique`,
  and the shared inline fragment in `cleanupDesktops` (`kwin/src/controller.ts`)
  each do nothing but rebuild their mode's mapping; grep-confirmed zero
  remaining `workspace-cleanup-replenished` emissions anywhere in the file.
- Create-on-demand AC, all three modes: `finishWorkspaceZero`,
  `finishSharedWorkspaceZero`, `moveActiveToWorkspace`'s index-0 branch, and
  `finishMoveToTrailing` all call the relevant `appendDesktop*` function
  directly with no reuse lookup, in `global-unique` and `shared` (matching
  `per-output-local`'s already-converted pattern); grep-confirmed zero
  remaining references to the deleted reuse helpers
  (`trailingOwnedEmptyForGlobalUnique`, `trailingOwnedEmptiesInSubset`,
  `trailingOwnedEmptyDesktop`, `appendDesktopForGlobalUniqueKey`).
- Redundant-guard removal: `position === lastIndex` and its `lastIndex`
  parameter removed from all three `removeOwnedEmpty*` functions and their
  sole caller, `cleanupEligibleDesktops`; `planDesktopCleanup`'s own
  `orderedIds.length <= 1` floor (`kwin/src/logic.ts`, unchanged from Unit 4)
  is the sole remaining removal-authority floor, confirmed by direct reading.
- Typecheck: `npm --prefix kwin run typecheck` clean (both `tsconfig.json` and
  `tsconfig.test.json`), Lead-verified directly.
- Not yet covered (next dispatch, `state.md`): the five affected
  `controller.test.ts` blocks (per-output-local, global-unique, shared,
  legacy dynamic-virtual-desktops, Unit-04-seam) have not been updated yet and
  will fail at runtime against the new behavior (typecheck-clean but not
  test-green); full-suite `npm --prefix kwin test` has not been run this
  stint; live acceptance (Unit 9) not started.

Bug 2 (Unit 5, test-update half), 2026-08-19 (Lead succession 4) -
`worker-anthropic`, attempt-1, 0 corrections:
- Pre-dispatch ground-truth check (this Lead, direct): ran `npm --prefix kwin
  run typecheck` (clean, matching state.md) and a fresh full-suite run before
  dispatching, to rule out the possibility that the prior succession's
  quota-cancelled dispatch had silently advanced the test half. All five
  target blocks (`TileController dynamic virtual desktops`, `... (Unit 04)`,
  `... (Unit 05)`, `... (Unit 06)`, `... (Unit 07)`) were still failing
  (55/519 `controller.test.js` failures, `logic.test.js` 80/80 green,
  unaffected) - confirmed state.md's account was accurate and no work was
  lost or duplicated.
- All five named blocks reconciled against the three ground-truth behavior
  changes (no replenish; always-create for Meta+0/Shift+0; no
  positionally-last removal guard, only the true last-global-desktop floor).
  Four now-meaningless "idempotent reuse" tests deleted (per-output-local x2,
  global-unique x1, shared x1) with a verified reason: always-create makes a
  second Meta+0 press inherently non-idempotent, so the old assertion path is
  unreachable by construction, confirmed by this Lead directly (fresh id can
  never equal the pre-creation current id). One additional dead test deleted
  from the legacy block (`defers middle-empty switch cleanup when {mode}
  mapping becomes invalid`) - Lead-verified via direct grep that both the
  `workspace-cleanup-deferred:mapping-unknown` diagnostic and the
  `cleanupAfterWorkspaceSwitch` method name it called no longer exist
  anywhere in `controller.ts` (renamed `cleanupEligibleDesktops` by Unit 4);
  this predates unit-05 and was correctly swept as part of this block's
  reconciliation, not a scope violation.
- Lead independently re-derived (not just re-read) one subtle claim in the
  Worker's report: four deferred-cleanup diagnostic counts changed from
  asserting 1 occurrence to 2 (`output-visibility-unknown` x2,
  `window-occupancy-unknown` x2). Verified directly via grep that each
  diagnostic string has exactly two emission call sites in `controller.ts`
  (one top-level pre-check, one inside `cleanupEligibleDesktops`'s own
  re-read) - the doubled count is a genuine, correctly-reasoned consequence
  of Q7's broadened trigger, not an error.
- Typecheck: `npm --prefix kwin run typecheck` clean (both configs),
  Lead-verified directly, independent of the Worker's own report.
- Full suite: Lead-verified directly (not just Worker-reported), fresh run:
  `ℹ tests 802`, `ℹ pass 802`, `ℹ fail 0` (`node --test` on
  `dist/tests/**/*.test.js`), plus the shell smoke test `passes: 271
  failures: 0`. All five target blocks 100% green; zero residual failures
  anywhere in the suite. `kwin/tests/logic.test.ts` untouched by this
  dispatch (diff is Unit 4's pre-existing 26-line diff only, confirmed by
  direct `git diff` inspection).
- Diff review: Lead read the full 936-line `controller.test.ts` diff
  directly, in full, in four sequential chunks - not the Worker's summary
  alone. Assessment: assertions were tightened (many `.length === 0` checks
  replaced with precise `deepEqual` id lists), not weakened; every renamed
  test's new title and inline comment accurately describes its new
  assertions; no sign of coverage loss disguised as a passing suite.
- Not yet covered by this unit (deferred to Units 8/9/10 per plan): full-suite
  reconciliation beyond these five blocks (the two stale "replenish" doc
  comments and the two now-unreachable `already-trailing-empty` no-op
  branches flagged in state.md), live acceptance, independent review.

Bug 2 (Unit 4), 2026-08-18 - `worker-anthropic`, attempt-1 + 1 same-scope
correction (comment-only):
- Cleanup eligibility ACs "ownership plays no role" and "no reserved-spare
  exemption": `kwin/tests/logic.test.ts` `planDesktopCleanup` describe block,
  `kwin/src/logic.ts:823-868` diff (`ownedIds`/`protectedTrailingIds` removed
  from `DesktopCleanupRequest` and the predicate).
- Removal trigger scope AC (Q7) and output disconnect AC (Q5):
  `kwin/tests/controller.test.ts` "requests the same cleanup pass on every
  dispatcher trigger" and "removes an empty invisible middle desktop on a
  non-switch trigger too" tests; `kwin/src/controller.ts` diff removing the
  four `if (switchCleanup)` gates in `cleanupDesktops` and the `switchCleanup`
  parameter itself.
- Typecheck: `npm --prefix kwin run typecheck` clean (Lead-verified directly,
  twice: post-implementation and post-correction).
- Tests: Lead-verified directly via full `npm --prefix kwin test` run:
  795/805 pass, exactly the 10 failures the Worker predicted, all confined to
  the per-mode `Unit 05`/`Unit 06`/`Unit 07` describe blocks (still asserting
  the superseded ownership/reserved-spare model Units 5-7 own) plus one
  `Unit 04` mode/seam test; no failures outside those blocks. `logic.test.ts`
  and the generic "TileController dynamic virtual desktops" block independently
  green.
- Not yet covered by this unit (deferred to Units 5-7/8/9 per plan): per-mode
  replenish deletion, `Meta+0`/`Meta+Shift+0` create-on-demand, live
  acceptance.

Bug 1 (Unit 2), 2026-08-18:
- Root cause: KWin 6.7.3 source trace (`xkb.cpp`, `keyboard_input.cpp`,
  `scripting.cpp`, `globalshortcutsregistry.cpp`) plus Node arithmetic
  reproducing Qt's `QKeySequence` int-combination rules for all ten digits;
  host layout confirmed `us` (`localectl status`, `setxkbmap -query`).
- Tests: 805 -> 807 (`npm --prefix kwin test`, all passing); catalog pinned
  fixtures, `REGISTERED_PROFILE_ACTION_IDS` derivation, and the shipped-bundle
  smoke test's `EXPECTED_SHORTCUT_COUNT` (52 -> 62) all updated; two new
  focused invocation tests added confirming the `-symbol` shortcut IDs
  dispatch identically to their canonical siblings.
- Typecheck: `npm --prefix kwin run typecheck` clean.
- Live: bundle reinstalled (`dogfood-install.sh install`), reloaded
  (`disable`+`enable`), confirmed byte-identical on disk, `shortcut-registered`
  / `startup-handlers-ready` fired with zero `shortcut-register-failed`.
  `allShortcutInfos` for all ten new `-symbol` actions matches the
  mathematically-derived delivered-event integer exactly.
- **Not obtained:** a live callback firing from an actual key press (blocked
  by the residue collision above, and by the standing prohibition on
  synthetic input / asking the user to press keys within this stint).
- Side effect: reload triggered Bug 2's already-known defect (one extra empty
  desktop created); documented in spec.md, left in place rather than looped
  on further (see Residual Risks).

## Residual Risks

- **Updated 2026-08-18 (verification stint):** the KGlobalAccel "residue"
  (spec.md Q4) is identified as the user's own git-committed,
  Home-Manager-declared `last-desktop` KWin script
  (`dotfiles-nix/modules/home/displayManager/plasma6.nix`, 2026-08-10),
  currently declared-enabled but not currently deployed/loaded on this host.
  It was **not removed** (STOP condition: belongs to a tool the user actively
  maintains). Live-confirmed via `KGlobalAccel.action(<key>)` (authoritative,
  not inferred) that it still wins the tie-break for all ten sequences, so
  Bug 1's fix remains unproven live on this host, and a physical keypress
  right now would likely do nothing (claimed by a dead action, not this
  project's live one). **Higher-priority open risk:** Bug 1's fix (and any
  Bug 2 implementation) may be entirely redundant with tooling the user has
  already built himself (`last-desktop` script for Bug 1's problem,
  `pkgs.kdePackages.dynamic-workspaces` for Bug 2's problem, both declared in
  the same file). This needs an Orchestrator/user scope decision before
  further Bug 1/Bug 2 work, not just a residue cleanup.
- Also corrected: the fix's "correct on AZERTY" claim was wrong (spec.md,
  "Layout verification matrix"). AZERTY is actively harmed (silent collision
  with `Meta+<digit>` focus-workspace), not merely uncovered. UK and German
  QWERTZ are each only partially covered by the `-symbol` alias.
- **New:** any future reload of this script (for Bug 2 work or otherwise)
  will trigger the same "one extra empty desktop" side effect until Bug 2 is
  fixed; expect and account for it rather than treating it as a surprise.
- Bug 2's live acceptance (Unit 5) must not destroy the user's real,
  currently-in-use desktops 1 and 2 or any window on them; only empty,
  invisible desktops (3-12, plus the one extra from this stint's reload, or
  whatever remains empty and invisible at execution time) are cleanup
  targets.
- Both fixes touch `controller.ts`; Unit 10 exists specifically to catch any
  interaction between the two changes before they are considered complete.
- **New:** Units 4-10 (seven units, up from three) raises the chance this
  change needs Lead succession before Bug 2 completes; if a second succession
  occurs, `state.md` becomes required per the Expanded-trigger rule in
  `artifacts.md`. Not yet triggered.
- **New:** the ~45-50-test estimate (survey, not yet ground-truthed by a
  Worker actually running the suite) is approximate; Unit 8 exists partly to
  catch any undercount before Bug 2 is considered done.
- **New (Unit 10, not fixed, tracked as a backlog follow-up):** 7 stale
  doc-comment locations (one user-visible, in the `Meta+0` shortcut's
  settings-UI description string) and one duplicated-diagnostic-read
  inefficiency remain in `controller.ts`, all leftover documentation/cleanup
  drift from Units 4-10's implementation. See `docs/backlog.md`.
- **Two evidence gaps carried forward as unproven-live, not folded into
  "accepted" (deliberate Lead scoping decisions, not defects):**
  "empty-but-visible desktop is preserved" has static test coverage only
  (units 4/5/8) - proving it live would require switching the user's visible
  desktop, which is prohibited. `Meta+0`/`Meta+Shift+0` create-on-demand has
  no physical-keypress proof - `invokeShortcut` over D-Bus bypasses the xkb
  layer used by the actual bug/fix mechanism and would prove nothing; the
  incoming COSMIC-style trailing-empty-workspace rework will replace this
  behavior anyway, so this is not being chased further.

## Final Outcome

Bug 2: implemented and accepted 2026-08-19 (Lead successions 3-10, units
3-10). Cleanup eligibility is ownership-independent and visibility-based;
the replenish loop is removed in all three `workspaceMode` values;
`Meta+0`/`Meta+Shift+0` always create, never reuse; removal fires on every
`cleanupDesktops()` dispatch, not only workspace switch; output disconnect
removes immediately with no grace period. Full-suite reconciliation (unit-8),
live acceptance on the user's real host (unit-9: sweep removed zero of the
user's 4 populated desktops, a throwaway empty desktop was auto-removed with
zero replenish, baseline restored byte-for-byte), and independent review
(unit-10, accept-with-non-blocking-findings) are all complete. Two live-proof
items remain deliberately unproven (see Residual Risks) and one small
documentation/cleanup item is deferred to the backlog (see `docs/backlog.md`).

Bug 1: fixed and live-deployed 2026-08-18. Root cause confirmed (shifted-symbol
delivery, not a registration or scripting-capability defect). Fix registers a
compatibility-alias shortcut per digit under the QWERTY-family shifted symbol,
alongside the unchanged canonical `Meta+Shift+<digit>` row. **Not** correct on
AZERTY-style layouts - see the CORRECTION in spec.md's Bug 1 section and the
"Layout verification matrix" there; this paragraph's earlier AZERTY claim was
superseded the same day it was written. Live-verified through registration;
full physical-key proof is blocked by an unrelated, pre-existing KGlobalAccel
residue collision discovered during live verification, escalated as spec.md
Q4 (carried forward as an open backlog item, not resolved this change). Bug 2
is implemented, accepted, and live-verified (see above) - both bugs are now
complete for this change.
