# State: Workspace Management Fixes

Created on the second Lead succession, per the Expanded-trigger rule in
`artifacts.md`. Carried forward by the third, fourth, and fifth Lead
successions.

- Current major unit / attempt: **unit-10 attempt-1 is ACCEPTED (tenth Lead
  succession, 0 corrections).** **Bookkeeping note on how this was reached:**
  the incoming tenth Lead succession found this exact section already
  describing a "unit-10 accepted" outcome and an already-applied
  observability fix in its very first read of this file - but `log.md` had
  no succession-9 or succession-10 entry anywhere, and `plan.md` had no
  Unit-10 Acceptance-Criterion Evidence entry. No inspectable Worker report
  existed for the claimed prior review. This is consistent with a
  quota-cancelled session whose tool calls (file edits) persisted to disk
  but whose final report/bookkeeping did not complete. The incoming Lead did
  **not** accept the narrative on faith: it independently re-verified every
  concrete, reproducible claim directly (typecheck clean; `802/802` tests +
  `271/271` smoke; `git diff --check` clean; build SHA-256
  `8ee1eabb52d16c656aa022c36801b2f39543ab4c3445f849116708b2c6a3d18a`
  reproduced exactly; the three `workspace-cleanup-removed:${id}` call sites
  confirmed present at `controller.ts:8259,8394,8721`) - all of which
  reproduced exactly, giving confidence the underlying file changes are
  real and sound - and then dispatched a **genuine fresh `worker-anthropic`**
  for the unit-10 review rather than treat the unverifiable prior claim as
  the review. That fresh dispatch returned verdict
  "accept-with-non-blocking-findings" against every spec.md Bug 2
  acceptance criterion (all met). The Lead then independently re-verified
  the report's substantive claims directly and found two of its line-number
  citations wrong (one off by ~185 lines, one off by ~11,200 lines) while
  every underlying technical claim reproduced exactly once checked at its
  real location - a citation-precision defect in the report, not a code
  defect, not grounds to reject. Full detail in `plan.md`'s Unit 10
  Acceptance-Criterion Evidence entry.
- **Observability gap: already fixed (verified real, not redone).** The
  `workspace-cleanup-removed` diagnostic at all three call sites
  (`removeOwnedEmptyShared`, `removeOwnedEmptyDesktop`,
  `removeOwnedEmptyGlobalUnique` in `controller.ts`) now emits
  `` `workspace-cleanup-removed:${id}` `` instead of the bare string,
  matching the existing `workspace-cleanup-remove-failed:${...}` pattern.
  Confirmed real via direct grep and confirmed sound via the fresh
  typecheck/test/build re-verification above (main.js hash
  `8ee1eabb...931b0af9735` differs from unit-08's
  `ab6ad59d...80bf931b0af9735` precisely because this diagnostic string
  changed, as expected).
- **New findings this stint, not fixed, recorded as a backlog follow-up
  instead (per the Orchestrator's explicit instruction to avoid scope creep
  ahead of the imminent COSMIC-style rework):** the fresh unit-10 review
  found 7 stale doc-comment locations describing the removed
  ownership/reserved-trailing-empty model (one is user-visible - the
  `Meta+0` shortcut's KDE-settings-UI description string, `controller.ts:615`,
  still reads "Focus or create the trailing empty workspace") and one
  duplicated-diagnostic-read inefficiency (`cleanupDesktops()`/
  `cleanupEligibleDesktops()` each independently re-read
  `visibleDesktopIds()`/`occupiedDesktopIds()`, doubling API calls and
  duplicate deferred-diagnostic log lines per cleanup pass - harmless
  functionally). See `docs/backlog.md` for the new entry.
- unit-09 attempt-2 (ninth Lead succession, 0 corrections): the occupancy-baseline precondition was
  answered by the user directly (all four current desktops - `392a73ad`
  Desktop 1 visible, `ec13f70f` Desktop 3, `41cee7be` Desktop 4, `dd68d41e`
  "4" - hold windows). A `worker-anthropic` live test proved: (1) enabling the
  plugin's startup sweep removed none of the 4 real, populated desktops and
  never changed `current`; (2) a freshly created, never-switched-to, empty
  throwaway desktop was auto-removed by the live `cleanupDesktops`/
  `desktopsChanged` path with zero `workspace-cleanup-replenished` anywhere in
  the whole test; (3) baseline (`enabled: no`, exact 4-desktop set, `current`)
  was restored byte-for-byte. **This Lead independently re-verified all of
  it directly** (not just the Worker's report): a fresh
  `start-test.sh desktops`/raw `current`/`dogfood-install.sh status` read
  matching the Worker's final-state claim exactly, plus a direct
  `journalctl --user _PID=23049` read confirming zero
  `workspace-cleanup-removed` during the 08:30:20 startup epoch and exactly
  one at 08:30:36 (the throwaway), with zero `workspace-cleanup-replenished`
  anywhere. See plan.md's Work Units row 9 and "Acceptance-Criterion
  Evidence" for full detail, including the deliberate scoping decision to
  skip live-reproving "empty-but-visible is preserved" (already covered by
  accepted unit-level evidence; live-testing it would require switching the
  user's visible desktop, which is prohibited) and to skip
  `Meta+0`/`Meta+Shift+0` physical-keypress proof (needs the user to press a
  key, out of scope for this dispatch). **Next: unit-10 (independent review
  of the full Bug 2 diff), then the completion transaction if it lands clean.**
  unit-05 and unit-08 remain fully accepted from prior successions - do not
  re-dispatch any part of them.
- Completed units: unit-01, unit-02 (Bug 1, both accepted), unit-03 (Bug 2
  decision gate Q2, accepted), unit-04 (Bug 2 shared foundation - accepted
  with 1 same-scope correction), unit-05 (accepted in full, see plan.md
  Progress and Acceptance-Criterion Evidence sections for both halves),
  unit-08 (Bug 2 full-suite reconciliation - accepted in full, see plan.md
  Work Units table row 8 and log.md's 2026-08-19 succession-5 entry). Units
  06 and 07 are superseded/merged into unit-05 (do not dispatch them
  standalone).
- **Desktop 2 incident: RESOLVED (2026-08-19, eighth Lead succession).** The
  user confirmed directly (relayed via the Orchestrator) that all his windows
  are intact - nothing was lost. The standing "no further live action" block
  is CLEARED. Journal triage (worker-anthropic, curated report; see log.md's
  2026-08-19 succession-8 entry for full evidence) plus direct Lead reading
  of `occupiedDesktopIds()`/`cleanupEligibleDesktops()`
  (`kwin/src/controller.ts:8202-8240,8770-8795`) established: every one of
  the 10 removals in the incident epoch was gated by its own freshly-read,
  fully-decoded live occupancy check that same iteration (zero
  `workspace-cleanup-deferred:window-occupancy-unknown` events); the
  guard/defer mechanism was actively firing and obeyed during concurrent
  drag/move activity, not bypassed; the sticky/`onAllDesktops` occupancy
  exclusion is pre-existing, unchanged, user-approved semantics, not a Bug 2
  change. **Ruling: the code correctly saw Desktop 2 as empty (of non-sticky
  windows) at removal time. This was the prior Lead's own bookkeeping gap
  (relied on an inherited, unverified dispatch-brief claim instead of a fresh
  baseline of its own), not a defect in `planDesktopCleanup` or
  `occupiedDesktopIds`.** unit-04 and unit-05 acceptance stands; no
  reopening needed.
- Blockers: **none.** unit-09 is accepted; no code-defect blocker remains and
  no live-safety blocker remains. Bug 1 has two open, non-blocking residual
  items already escalated (spec.md Q4 live-keypress proof still outstanding;
  not this Lead's queue).

## Ground truth at handover (verified directly this stint, not inherited on faith)

- `git status --short`: same eight modified/untracked files as recorded by
  the prior succession (`kwin/src/{controller,logic}.ts`,
  `kwin/tests/{controller,logic}.test.ts`, `kwin/contents/code/main.js`,
  `docs/changes/workspace-management-fixes/{spec,plan,log}.md`, this
  `state.md` untracked) - unit-08 only touched `kwin/src/controller.ts` and
  `kwin/contents/code/main.js` (already-modified files), no new files
  entered the set. Nothing committed yet (`HEAD` still `538ad7f`, Bug 1's own
  commit).
- **Unit-08 verified this stint (Lead-direct, not Worker-report alone):**
  `npm --prefix kwin run typecheck` clean (both configs); `npm --prefix kwin
  run test`: `tests 802`, `pass 802`, `fail 0`, shell smoke `passes: 271
  failures: 0`; `npm --prefix kwin run build` run by the Lead directly,
  `sha256sum kwin/contents/code/main.js` =
  `ab6ad59d43a0317835fd101bc71893e46585a35b23307d74180bf931b0af9735`, matching
  the Worker's own independent two-run check. `git diff kwin/src/controller.ts`
  read directly by the Lead; the two doc-comment fixes, both dead-branch
  removals, and their cascading unused-code cleanup were confirmed present
  and isolated; the much larger remainder of the cumulative (uncommitted,
  HEAD-relative) diff was cross-checked against state.md's own existing
  unit-04/unit-05 descriptions and confirmed pre-existing, not new. Test file
  diff stats (`controller.test.ts` 936, `logic.test.ts` 26) matched the
  already-known unit-05 figures exactly, confirming zero test edits this
  stint (matching the Worker's claim).
- **Verified before dispatching this stint's Worker** (per the "verify actual
  progress before assuming anything" instruction, given the prior dispatch
  was quota-cancelled): `npm --prefix kwin run typecheck` clean; a fresh full
  suite run showed all five unit-05 target blocks in `controller.test.ts`
  still failing (55/519 failures), `logic.test.ts` 80/80 green and
  unaffected. This confirmed the cancelled dispatch had **not** silently
  advanced the test half and state.md's prior account was accurate - no
  wasted or duplicated work.
- **Verified after this stint's Worker dispatch** (Lead-direct, not
  Worker-report alone): `npm --prefix kwin run typecheck` clean (both
  configs); fresh full-suite run: `ℹ tests 802`, `ℹ pass 802`, `ℹ fail 0`
  (`node --test dist/tests/**/*.test.js`), plus shell smoke `passes: 271
  failures: 0`. All five target blocks 100% green, zero residual failures
  anywhere in the suite. The full 936-line `kwin/tests/controller.test.ts`
  diff was read directly by this Lead in full (four sequential chunks), plus
  targeted greps confirming two specific subtle claims in the Worker's report
  (the four deleted "idempotent reuse" tests are provably unreachable by
  construction now that Meta+0/Shift+0 always create; four deferred-cleanup
  diagnostic-count assertions doubled from 1 to 2 correctly, matching two
  emission call sites per diagnostic string in `controller.ts`). Assessment:
  assertions were tightened, not weakened; no coverage loss found.
  `kwin/tests/logic.test.ts` confirmed untouched by this dispatch (still
  Unit 4's pre-existing 26-line diff only).
- Source behaviour in the tree (unchanged since succession 3, still correct,
  restated for a fast orientation - do not re-verify unless you have reason
  to distrust it): replenish removed in all three modes; the redundant
  `position === lastIndex` guard is gone, `planDesktopCleanup`'s
  `orderedIds.length <= 1` floor in `logic.ts` is the sole removal authority;
  `Meta+0`/`Meta+Shift+0` always-create in all three modes across four
  call-site groups; four dead helpers deleted.

## Residuals from unit-05, all now closed out by unit-08

- Both stale "trailing-empty replenish" doc comments (`appendDesktopForOutputKey`,
  `appendDesktopForGlobalUnique`) fixed by unit-08.
- Both `already-trailing-empty` no-op branches (`focusTrailingEmpty`,
  `finishSharedWorkspaceZero`) confirmed genuinely unreachable and removed by
  unit-08, with cascading removal of the now-unused
  `currentDesktopIdForOutput`/`currentDesktopIdGlobal` helpers and the unused
  `output` parameter of `finishSharedWorkspaceZero`.
- The borderline-case survey was re-run fresh by content/grep (old plan.md
  line numbers 12530/12539/12967/14499 discarded as stale, per this file's
  prior instruction) - zero remaining stale references to the removed
  ownership/protected-trailing/reuse model found in either test file.

No open residuals remain from units 4/5/8.

## Next action for the incoming Lead: unit-10, then the completion transaction

unit-09 is accepted (2026-08-19, ninth Lead succession, attempt-2, 0
corrections) - see plan.md's Work Units row 9 and "Acceptance-Criterion
Evidence" for the full live-test evidence (sweep removed zero real desktops;
throwaway auto-removed with zero replenish; baseline byte-for-byte restored;
both Worker-reported and this Lead's own independent journal/D-Bus
re-verification agree). No further live-safety action is pending on unit-09.

`invokeShortcut` over D-Bus does not prove shortcut delivery (bypasses xkb) -
`Meta+0`/`Meta+Shift+0` physical-keypress proof was deliberately not
attempted this stint (needs the user to physically press a key; ask the
Orchestrator to ask him if that proof is ever required) and live-reproving
"empty-but-visible is preserved" was deliberately skipped as it would require
switching the user's visible desktop (prohibited) - both are Lead scoping
decisions, not gaps against this unit's actual acceptance criteria (spec.md's
live AC is about removal/no-replenish, not those two properties; both are
otherwise covered by accepted unit-level test evidence or already escalated
elsewhere).

**Unit-10 is now accepted (tenth Lead succession, attempt-1, 0 corrections;
see above and `plan.md`'s Unit 10 Acceptance-Criterion Evidence entry for
full detail).** Every Bug 2 unit (3-10) and both Bug 1 units (1-2) are now
accepted with no open blocker anywhere in the queue. The completion
transaction is next: commit + push (this is the queue's **final** commit per
explicit user instruction - no further commits/pushes after this one until
further notice), correcting `docs/backlog.md:22-25` and
`docs/roadmap.md:172-186,220-222` (still describe the superseded
trailing-empty design), recording the Desktop 2 incident and its resolution
in `docs/live-kwin-testing.md`'s Attempt Lessons/Current Boundary section
(append, do not rewrite that historical record), adding the new
stale-comment/duplicated-read backlog follow-up item, adding a backlog entry
for the incoming COSMIC-style trailing-empty-workspace model as the user's
next selected work, and archiving this change per the process. Do not edit
`docs/decisions.md`. Keep `docs/backlog.md` line 41 (P1 layout-correct-
shortcuts launch blocker) - update its dependency wording only, do not
remove it. Carry Bug 1's Q4 KGlobalAccel item forward as an open backlog
item.

Attempt counts belong to the semantic unit and are inherited, never reset by
succession. A third attempt, a second correction round, or a second independent
review on one unit trips a circuit breaker. List a unit only once one of its
counts exceeds 1; absence means all counts are 1 or lower.

| Unit | Attempts | Corrections | Independent reviews |
|---|---|---|---|
| unit-04 | 1 | 1 | 0 |
| unit-09 | 2 (attempt-1 stopped on a live-safety trigger, resolved and not a code defect, not counted against attempt-2; attempt-2 **accepted** 2026-08-19, 0 corrections) | 0 | 0 |
| unit-10 | 1 | 0 | 1 (this stint's fresh `worker-anthropic` dispatch; no prior verifiable review existed despite a narrative claim to the contrary found at the start of this stint - treated as unattempted, not as a second review) |

unit-05 is fully accepted at 1 attempt per half (source half attempt-1/0
corrections, test half attempt-1/0 corrections) - no table entry needed
(only list once a count exceeds 1). No circuit breaker concerns anywhere in
this queue as of this handover; all units are accepted and the change is
ready for its completion transaction.
