# Log: Trailing Empty Workspace (COSMIC-style reuse)

Append-only. Append after a meaningful checkpoint: an accepted semantic unit,
verified partial result, blocker, pending user decision, unsuccessful host
attempt, context handover, semantic or governance change, independent review
finding, commit, or approved plan change. Each entry records timestamp, role
and work unit and attempt, result, changed files or commit, verification, and
any discovery, blocker, or required decision. No narration, copied output, or
speculation.

## 2026-08-19 (scoping)

- Role / unit: Lead / scoping (pre-unit-01)
- Result: Dispatched one `worker-anthropic` investigation task (read-only,
  no commits/pushes authorized or performed) surveying `kwin/src/controller.ts`
  reconcile/removal/cleanup-dispatch/shortcut logic, commit `538ad7f` as the
  pre-Q6 reference, `kwin/tests/controller.test.ts` structure, and the
  archived `workspace-management-fixes` spec/plan/log. Confirmed exact
  current test baseline: 802/802 passing (`node --test`). Drafted `spec.md`
  and `plan.md` for user/Orchestrator review; no implementation started.
- Files / commit: created `docs/changes/trailing-empty-workspace/{spec.md,plan.md,log.md}`; no other files touched; no commit made (commits/pushes prohibited this session).
- Verification: n/a (scoping only).
- Notes: Several product ambiguities surfaced in `spec.md` Unresolved
  Questions (Q-Domain, Q-Zero, Q-Manual, Q-Pager, Q-MultiOutput). One
  discrepancy found (Q-Diagnostic-ID): the Orchestrator's brief described
  `workspace-cleanup-removed` diagnostics as missing a desktop ID, but
  current code (`controller.ts:8259,8394,8721`) already logs
  `workspace-cleanup-removed:${id}`. Awaiting user approval of `spec.md`
  before any Worker implementation is dispatched.

## 2026-08-19 (Lead succession, rulings encoded)

- Role / unit: Lead / pre-unit-01
- Result: Succeeded prior scoping Lead. User ruled on all three surfaced
  ambiguities (Q-Domain: per-output in `per-output-local`, global in
  `global-unique`/`shared`; Q-Zero: no-op; Q-Manual: removed when not
  visible / self-healing), matching the Lead's prior recommendation in each
  case. Q-Pager accepted as-is. Q-Diagnostic-ID confirmed resolved (stale
  brief; ID already present per `controller.ts:8259,8394,8721`). Encoded
  rulings into `spec.md` (Status -> Approved, Unresolved Questions ->
  Resolved Questions, Consequential Decisions populated) and reflected them
  in `plan.md` (Status -> Approved, Pending User Decisions cleared).
  Dispatching unit-01 next.
- Files / commit: edited `docs/changes/trailing-empty-workspace/{spec.md,plan.md,log.md}`; no commit (commits/pushes prohibited this session).
- Verification: n/a (record-keeping only).
- Notes: No commits or pushes made. Working tree left uncommitted per
  standing constraint.

## 2026-08-19 (unit-01)

- Role / unit: Lead / unit-01, attempt-01 (worker-anthropic)
- Result: Accepted. Dispatched `worker-anthropic` to implement
  `ensureTrailingEmptyDesktop(request): TrailingEmptyDomainResult` at
  `kwin/src/controller.ts:1651-1719` - stateless, structural (last-position-
  if-empty) trailing-empty identification, single-pass remove-then-append-if-
  needed, no ownership Set, no debounce/timer, per plan.md's anti-oscillation
  design. Added isolated `describe("ensureTrailingEmptyDesktop", ...)` unit
  tests at `kwin/tests/controller.test.ts:8419-8528` (6 cases: no-op when
  trailing already empty; append-only when occupied; remove non-trailing
  invisible empty; combined remove+append in one pass; idempotency across
  repeated calls; never removes visible-but-empty). Not yet wired into any
  mode's `cleanupDesktops()` or `Meta+0`/`Meta+Shift+0` handlers (units
  02-04). Lead inspected the actual diff (not summary) and independently
  reran the full test suite, reproducing the Worker's reported result
  exactly.
- Files / commit: `kwin/src/controller.ts` (+75 lines), `kwin/tests/controller.test.ts` (+112 lines). No commit (prohibited this session).
- Verification: `devenv shell --impure -- bash -c "cd kwin && npm run build
  && rm -rf dist/tests && esbuild 'tests/*.test.ts' --bundle --platform=node
  --format=cjs --target=es2020 --outdir=dist/tests && node --test
  'dist/tests/**/*.test.js'"` -> 808/808 pass (802 baseline + 6 new), 0 fail,
  independently reproduced by the Lead (not just Worker-reported).
- Notes: Worker flagged one brief ambiguity: "last-positioned empty in domain
  order" could mean literal-last-index-only-if-empty (implemented) vs.
  scan-backward-for-first-empty-from-end (rejected as it makes the
  combined remove+append test case impossible to construct). Lead reviewed
  and concurs literal-last-index is correct and matches plan.md step 3's
  wording ("empty desktop at the trailing (last) position"); recorded here
  so units 02-04 use the same   interpretation. Attempt count: 1 (no entry
  needed in Attempt Accounting per governance - only units exceeding 1
  attempt are recorded). No commits, staging, or pushes.

## 2026-08-19 (Lead succession, ground-truth reconciliation)

- Role / unit: Lead / pre-unit-02 (ground truth)
- Result: New Lead succession after prior dispatch was cancelled mid-flight
  (Worker consumed 340k tokens, quota exhausted, no report/log entry
  produced). log.md only recorded unit-01 as accepted, but the uncommitted
  working tree is materially larger than unit-01 alone accounts for.
  Reconciled via `git diff --numstat` (never full diff) and targeted `grep`
  for hunk headers and method signatures, plus one full `npm run typecheck`
  and one full test run:
  - `kwin/src/controller.ts`: +239/-35 (net +204, vs. unit-01's claimed
    +75). Extra hunks fall entirely within `TileController` methods
    `finishWorkspaceZero`, `finishLocalWorkspaceZero`, `focusTrailingEmpty`,
    `finishMoveToTrailing`, `cleanupDesktops`, `reconcileLocalWorkspaces`,
    plus two new private methods `enforceLocalTrailingEmpties` (calls
    `ensureTrailingEmptyDesktop`, ~controller.ts:8419-8457) and
    `resolveLocalTrailingEmpty` (~controller.ts:8458-8481), and a new
    `isCurrentOnOutput` helper (~controller.ts:8482-8498). This is exactly
    unit-02's declared scope in plan.md (per-output-local wiring) - shape is
    coherent, not a mixture of unrelated units.
  - `kwin/tests/controller.test.ts`: +393/-227 (net +166, vs. unit-01's
    claimed +112). Extra hunks: new shared test helper `ownTrailingEmpty`
    at ~line 663 and `setup()` changes ~634-663 (shared infra, used broadly);
    in-place rewrites inside "TileController dynamic virtual desktops"
    (12395-13628) and "TileController workspace mode and per-output seams
    (Unit 04)" (14421-14755) blocks - both nominally unit-05 scope per
    plan.md, but here the edits are narrow adjustments to keep those
    pre-existing tests compatible with the new per-output-local trailing
    behavior, not a start on unit-05's full sweep; and substantial rewrites
    inside "TileController per-output-local workspaces (Unit 05)" block
    (14755-15212), which is unit-02's declared test scope.
  - `npm --prefix kwin run typecheck`: clean, 0 errors.
  - Full test run (build + esbuild bundle + `node --test`): 808 tests,
    803 pass, 5 fail - all 5 inside the "per-output-local workspaces
    (Unit 05)" describe block (14755-15212): "marks a removed output's
    owned empties as cleanup candidates once it disconnects, and a replug
    creates nothing (no replenish)" (test at 15015); "keeps per-output
    local lists id-keyed across a desktop rename/reorder" (15061); "selects
    the active screen's local target with no focused window (activeScreen
    = L)" (15115); "Meta+0 creates exactly one owned trailing empty when
    the active output's local set lacks one" (15157); "occupying an owned
    empty desktop never creates a replacement (no replenish)" (15179).
  - `kwin/contents/code/main.js`: build output is deterministic and
    reproduces the working-tree copy exactly after a fresh `npm run build`
    (git status showed no further diff after rebuild) - it is a faithful
    regenerated bundle of the current `controller.ts`/`main.ts`, not stale
    or hand-edited.
  - Finding: unit-02 (wire per-output-local mode) is genuinely present and
    coherent in shape, not incoherent or a mystery - but incomplete: 5
    failing tests remain, all within its own declared scope, and it was
    never brought to a review-ready state or logged by the cancelled
    Worker. Treating this as unit-02 attempt-1, still open (the cancelled
    Worker never produced a review-ready report, so this is a continuation
    of attempt-1, not yet a completed or corrected attempt). unit-03 and
    unit-04 (global-unique, shared) show no evidence of having been
    started - no hunks touch `reconcileGlobalUnique`, `removeOwnedEmptyGlobalUnique`,
    `finishSharedWorkspaceZero`, or the "global-unique workspaces (Unit
    06)" / "shared workspaces (Unit 07)" describe blocks. Decision:
    complete unit-02 attempt-1 in place (fix the 5 failures) rather than
    reset - the existing code and tests are coherent and match plan.md's
    unit-02 scope exactly.
  - Ran `bash scripts/dogfood-install.sh status` and took a fresh
    read-only desktop occupancy baseline (`qdbus6` virtual-desktop query)
    before any further action, per standing live-testing instruction - see
    separate host-baseline note below.
- Files / commit: `docs/changes/trailing-empty-workspace/log.md` only (this
  entry). No source files touched by the Lead. No commit (commits/pushes
  prohibited - user-only per updated commit protocol).
- Verification: `npm --prefix kwin run typecheck` (clean); full `node
  --test` run, 808 tests / 803 pass / 5 fail (counts only, not raw output,
  reported above).
- Notes: No commits, staging, or pushes performed. Dispatching a fresh
  `worker-anthropic` next to fix the 5 failing tests and bring unit-02 to
  review-ready, scoped tightly to `enforceLocalTrailingEmpties`,
  `resolveLocalTrailingEmpty`, `finishWorkspaceZero`,
  `finishLocalWorkspaceZero`, `finishMoveToTrailing`,
  `cleanupDesktops`/`reconcileLocalWorkspaces` in `controller.ts`, and the
  5 named failing tests plus their immediate `describe` block in
  `controller.test.ts` (14755-15212) only.
- Host baseline (read-only, no mutation performed): `bash
  scripts/dogfood-install.sh status` -> installed yes, enabled yes, script
  currently `loaded`; `start-test.sh status` -> 27 KGlobalAccel project
  action records present, one pre-existing shortcut drift
  (`plasma-auto-tiler-focus-right`, unrelated to this change, not touched).
  Fresh live desktop query (`busctl --user call org.kde.KWin
  /VirtualDesktopManager org.freedesktop.DBus.Properties Get ss
  org.kde.KWin.VirtualDesktopManager desktops`, read-only): 4 desktops
  currently exist - "Desktop 1", "Desktop 3", "Desktop 4", "4" (no "Desktop
  2", consistent with the already-resolved historical Desktop 2 incident,
  not a new finding). No sign of an unrecorded live mutation by the
  cancelled dispatch; nothing in this session has touched the live host.
  This is the Lead's own fresh baseline per standing procedure - not
  inherited from any prior claim.

## 2026-08-19 (unit-02, own baseline re-verification)

- Role / unit: Lead / unit-02 (pre-dispatch)
- Result: Re-verified the inherited test/typecheck claim with a fresh run
  rather than acting on the previous Lead's numbers. `npm --prefix kwin run
  typecheck` clean (0 errors, both `tsconfig.json` and `tsconfig.test.json`).
  Full build+bundle+test run reproduces exactly: 808 tests, 77 suites, 803
  pass, 5 fail, same 5 named failing tests, all inside "TileController
  per-output-local workspaces (Unit 05)" (`controller.test.ts:14755-15212`):
  "marks a removed output's owned empties as cleanup candidates once it
  disconnects, and a replug creates nothing (no replenish)"; "keeps
  per-output local lists id-keyed across a desktop rename/reorder"; "selects
  the active screen's local target with no focused window (activeScreen =
  L)"; "Meta+0 creates exactly one owned trailing empty when the active
  output's local set lacks one"; "occupying an owned empty desktop never
  creates a replacement (no replenish)". Own baseline matches the inherited
  claim exactly - proceeding on this basis, not the inherited claim.
  Recording unit-02 attempt count in Attempt Accounting (now at attempt-2,
  per Orchestrator's brief: cancelled dispatch = attempt-1, this dispatch =
  attempt-2; breaker trips on a third attempt). Dispatching a fresh
  `worker-anthropic` next, scoped per the prior Lead's plan: fix the 5
  failing tests only, bring unit-02 to review-ready, touching only
  `enforceLocalTrailingEmpties`, `resolveLocalTrailingEmpty`,
  `finishWorkspaceZero`, `finishLocalWorkspaceZero`, `finishMoveToTrailing`,
  `cleanupDesktops`/`reconcileLocalWorkspaces` in `controller.ts`, and the 5
  named tests plus their immediate describe block
  (`controller.test.ts:14755-15212`) only.
- Files / commit: `docs/changes/trailing-empty-workspace/{log.md,plan.md}`
  only. No source files touched by the Lead. No commit (user-only per
  updated commit protocol).
- Verification: `npm --prefix kwin run typecheck` (clean); full `node
  --test` run via the standard build+esbuild+test command, 808/803/5
  (counts only).
- Notes: No commits, staging, or pushes performed. No live host action this
  entry (record-keeping and static verification only).

## 2026-08-19 (unit-02, attempt-2, accepted)

- Role / unit: Lead / unit-02, attempt-2 (worker-anthropic, plus one
  same-scope correction round)
- Result: Accepted. Dispatched `worker-anthropic` to fix the 5 failing
  tests inside "TileController per-output-local workspaces (Unit 05)"
  (`controller.test.ts:14755-15212`), scoped to `enforceLocalTrailingEmpties`,
  `resolveLocalTrailingEmpty`, `isCurrentOnOutput`, `finishWorkspaceZero`,
  `finishLocalWorkspaceZero`, `finishMoveToTrailing`,
  `cleanupDesktops`/`reconcileLocalWorkspaces`. Worker reported
  `review-ready`: 4 of 5 failures were stale test assumptions from the
  pre-reuse ("always create, never replenish") model (fixed by updating
  expected ids/assertions to the cascade-replenish/reuse model); 1 was a
  genuine wiring gap (`enforceLocalTrailingEmpties` never swept desktops
  orphaned when their output disconnects) fixed by a new sweep. Lead
  inspected the actual diff (not the summary) per governance and found the
  new orphan-sweep gated eligibility on `this.ownedDesktopIds` (`for (const
  id of [...this.ownedDesktopIds])`) - a direct reintroduction of the
  ownership-gating anti-pattern this whole change family (and the prior
  `workspace-management-fixes` change before it) exists to eliminate: a
  non-owned, pre-existing desktop absorbed into the primary output's local
  list by `rebuildLocalMapping` (unchanged, `controller.ts:8520-8567`) would
  become permanently unremovable if the primary output disconnected, since
  it would never appear in `ownedDesktopIds`. Rejected `review-ready`;
  dispatched one same-scope correction round (same Worker session, `resume`
  via `task_id`) per governance ("rejected -> one same-scope correction
  round"), which does not itself count as a new attempt or trip the
  breaker. Correction: rewrote the sweep to iterate the full live desktop
  list (re-read fresh via `this.liveDesktops()` after the per-domain loop,
  not the pre-loop snapshot, to avoid re-attempting removal of an id the
  per-domain pass already removed in the same dispatch - the Worker's first
  correction attempt introduced and then self-caught this ordering bug via
  its own full test run before reporting back), filtered only by
  `assigned`/`occupied`/`visible`, matching the ownership-independent
  pattern already used by `cleanupEligibleDesktops` and the rest of
  `enforceLocalTrailingEmpties`. Worker added one new regression test,
  `"removes a non-owned pre-existing desktop left orphaned after its
  primary output disconnects"` (`controller.test.ts:15079-15116`), seeding
  two never-plugin-created desktops (`ownedDesktopIdSnapshot()` empty),
  disconnecting the primary output, and asserting the non-owned orphan is
  removed. Lead independently re-inspected the corrected diff directly
  (`controller.ts:8419-8479`, confirmed no `ownedDesktopIds` reference
  remains in the sweep, no new persistent/cached state, no debounce/timer)
  and the new test body directly, then independently reran the full build
  + typecheck + test suite, reproducing the Worker's reported result
  exactly.
- Files / commit: `kwin/src/controller.ts`, `kwin/tests/controller.test.ts`,
  `kwin/contents/code/main.js` (cumulative unit-01 + unit-02 diff vs.
  `884ff95`: `controller.ts` +304/-27 net across hunks in the 1635-8393
  old-line range; `controller.test.ts` +758/-324 net; `main.js` is a
  faithful regenerated bundle, reproduced deterministically by the Lead's
  own `npm run build` as part of the verification run). No commit
  (user-only per commit protocol).
- Verification (Lead's own, independent of Worker-reported):
  `npm --prefix kwin run typecheck` -> clean, 0 errors, both tsconfigs.
  Full build+esbuild+`node --test` -> 809 tests, 77 suites, 809 pass, 0
  fail, exit 0. `git diff --stat` and hunk-header locations for
  `controller.ts` independently confirmed the diff stays entirely within
  unit-01's helper (old line ~1635) and unit-02's declared method set (old
  lines ~7560-8393) - no out-of-scope method touched.
- Notes: unit-02 attempt count: 2 (recorded in plan.md Attempt Accounting,
  already >1 so kept per governance). One same-scope correction round used
  (not a second attempt) - breaker not tripped, has headroom for one more
  correction round on this unit if ever needed, though none is currently
  outstanding. No commits or pushes. Staged (not committed) at end of this
  dispatch - see Progress/staging note below.
