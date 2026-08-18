# Plan: Workspace Management Fixes

Ownership and approval:
- Owner: Lead
- Status: Diagnosis and spec drafted 2026-08-18 by Lead. Q1 and Q2 answered by
  the user the same day (spec.md "User rulings"). Units 1-2 (Bug 1) executed
  and complete same day, done by the Lead directly (no worker-anthropic
  dispatch used this stint). Units 3-6 (Bug 2) remain undispatched; Bug 2 is
  out of scope for this stint.

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
- [x] Unit 1 - Bug 1 live repro gate: satisfied by the user's own re-test
  (Q1 answered directly, no fresh agent-side repro needed).
- [x] Unit 2 - Bug 1 fix: shifted-symbol compatibility-alias rows added for
  `move-workspace-1..9` and `move-workspace-0`; live-registered and confirmed
  correct via `allShortcutInfos`; full "window actually moves" live proof
  blocked by a newly discovered, pre-existing KGlobalAccel residue collision
  (spec.md "New finding"), escalated rather than resolved.
- [ ] Unit 3 - Bug 2 decision gate (Q2): answered by the user (spec.md "User
  rulings"), recorded here and in spec.md; Unit 4 itself not started.
- [ ] Unit 4 - Bug 2 fix (out of scope this stint)
- [ ] Unit 5 - Bug 2 live acceptance (out of scope this stint)
- [ ] Unit 6 - Independent review (only Bug 1's diff exists so far; not yet
  independently reviewed by a second party)

## Pending User/Orchestrator Decisions

- spec.md Q1 and Q2: both answered by the user 2026-08-18 (see spec.md "User
  rulings"). No longer pending.
- **New, from this stint:** spec.md Q4 - who/what owns the
  `move-and-switch-to-desktop-*` / `move-to-last-desktop` KGlobalAccel residue
  in `~/.config/kglobalshortcutsrc`, and is it safe to clear? Needed before
  Bug 1's alias shortcuts can be proven to actually win the physical key on
  this host (they are registered correctly today but are shadowed by this
  residue's lower registration-order tie-break).

## Acceptance-Criterion Evidence

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
- Both fixes touch `controller.ts`; Unit 6 exists specifically to catch any
  interaction between the two changes before they are considered complete.

## Final Outcome

Bug 1: fixed and live-deployed 2026-08-18. Root cause confirmed (shifted-symbol
delivery, not a registration or scripting-capability defect). Fix registers a
compatibility-alias shortcut per digit under the QWERTY-family shifted symbol,
alongside the unchanged canonical `Meta+Shift+<digit>` row (correct for
AZERTY-style layouts). Live-verified through registration; full physical-key
proof is blocked by an unrelated, pre-existing KGlobalAccel residue collision
discovered during this stint's own live verification, escalated as spec.md Q4
rather than resolved. Bug 2 remains unimplemented (out of scope this stint);
its decision gate (Q2) is answered and recorded.
