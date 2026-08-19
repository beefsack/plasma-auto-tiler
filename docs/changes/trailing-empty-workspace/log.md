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

## 2026-08-19 (Lead succession, unit-03 scoping)

- Role / unit: Lead / pre-unit-03
- Result: New Lead succession. Confirmed unit-01 + unit-02 already committed
  by the user (`git log` shows `HEAD` at `1b34a37 feat(workspace): reuse
  trailing empty workspace in per-output-local mode`, working tree clean
  except pre-excluded untracked paths). Own fresh baseline re-verification
  (not trusting the inherited claim): `npm --prefix kwin run typecheck`
  clean (0 errors, both tsconfigs); full build+esbuild+`node --test` ->
  809 tests, 77 suites, 809 pass, 0 fail. Located current global-unique code
  via targeted grep (no full-file reads): `reconcileGlobalUnique`/
  `rebuildGlobalUniqueMapping` (`controller.ts:8888-8933`),
  `removeOwnedEmptyGlobalUnique` (`controller.ts:8938-8961`), the
  global-unique branch of `cleanupDesktops` (`controller.ts:8293-8300`), the
  three Meta+0/Meta+Shift+0 call sites that currently always-create for
  global-unique (`finishWorkspaceZero` ~7693-7697, `finishMoveToTrailing`
  ~7844-7849, `moveActiveToWorkspace` index-0 branch ~7981-7986), and the
  "TileController global-unique workspaces (Unit 06)" test block
  (`controller.test.ts:15282-15680`, 14 `it(...)` cases, ~5 of which encode
  the old always-create/no-reuse model and will need rewriting - same shape
  as unit-02's 5-test rewrite).
  Design finding requiring explicit brief guidance (not covered by any
  existing Q-ruling, which only addresses per-output-local multi-output):
  unlike per-output-local's per-output-disjoint domains, global-unique's
  trailing-empty domain is the single global desktop list, so a reused
  trailing empty can be currently visible/current on a *different* output
  than the one invoking Meta+0/Meta+Shift+0. The existing
  `globalUniqueSwapIfVisibleElsewhere` helper (`controller.ts:8794-8850`)
  already exists precisely for this class of problem (built for
  `navigateGlobalUnique` index>0 and the index>0 move-follow branch) and
  must be reused (not reinvented) at the three reuse call sites to preserve
  the existing "one current desktop per output, one assigned output per
  desktop" invariant; specified precisely in the unit-03 Worker brief.
  Confirmed no orphan-sweep equivalent is needed for global-unique (unlike
  unit-02's per-output-local case): the domain is defined as the full live
  desktop list, so every live desktop is always in-domain, and the
  reintroduced-ownership-gating defect class unit-02 hit does not have an
  analogous surface here (no parallel per-output domains for a desktop to
  fall between).
- Files / commit: `docs/changes/trailing-empty-workspace/log.md` only (this
  entry, plus the corresponding `plan.md` Progress update). No source files
  touched. No commit (user-only per commit protocol).
- Verification: `npm --prefix kwin run typecheck` (clean); full `node
  --test` run, 809/809 pass, 0 fail (counts only).
- Notes: No commits, staging, or pushes performed. No live host action this
  entry. Dispatching a fresh `worker-anthropic` next, scoped to unit-03 per
  plan.md: `reconcileGlobalUnique`, a new `enforceGlobalTrailingEmpty`
  helper method, a new `resolveGlobalTrailingEmpty` method, the three
  Meta+0/Meta+Shift+0 global-unique call sites, and the "global-unique
  workspaces (Unit 06)" describe block only.

## 2026-08-19 (unit-03, attempt-1, accepted)

- Role / unit: Lead / unit-03, attempt-1 (worker-anthropic)
- Result: Accepted, no correction round needed. Dispatched `worker-anthropic`
  scoped to global-unique mode only per plan.md. Worker wired `cleanupDesktops()`'s
  global-unique branch to a new `enforceGlobalTrailingEmpty()` (mirroring
  `enforceLocalTrailingEmpties()` but for a single global domain - the entire
  live desktop list ordered by `x11DesktopNumber`, not a per-output subset,
  per Q-Domain); added `resolveGlobalTrailingEmpty()` (mirrors
  `resolveLocalTrailingEmpty()`'s self-contained, no-cache shape); wired
  reuse-or-create into the three global-unique Meta+0/Meta+Shift+0 call sites
  (`finishWorkspaceZero` via new `finishGlobalWorkspaceZero`,
  `finishMoveToTrailing`, `moveActiveToWorkspace` index-0 branch). Per the
  Lead's brief, all three reuse call sites apply the pre-existing
  `globalUniqueSwapIfVisibleElsewhere` helper (already used by index>0
  navigation/move-follow, unmodified) so a reused trailing empty currently
  shown on a *different* output swaps to the active output rather than being
  duplicated - this is a genuinely new interaction unique to global-unique's
  single-domain design (per-output-local never needed it, since its domains
  are disjoint per output) and was specified precisely in the brief rather
  than left to Worker invention, given prior sessions' record of ambiguous
  briefs producing defects. No orphan sweep was added (correctly - unlike
  per-output-local, global-unique's domain is the entire live desktop list,
  so no desktop can fall outside it).
  Lead inspected the actual diff directly (not the summary): confirmed all
  9 hunks in `controller.ts` fall within the declared scope (the three call
  sites, `cleanupDesktops`'s global-unique branch, `reconcileGlobalUnique`'s
  comment, and the two new methods placed beside `removeOwnedEmptyGlobalUnique`);
  confirmed zero `ownedDesktopIds` references anywhere in the diff (`git diff
  ... | grep ownedDesktopIds` empty) - no reintroduction of the ownership-
  gating defect class found in unit-02's first attempt. Confirmed the two
  necessary adjacent-test fixes outside the Unit 06 block (in "TileController
  dynamic virtual desktops", a `for (const mode of [...])` parametrized
  cross-mode cleanup test) are narrow, in-kind fixes to keep pre-existing
  tests compatible with the new global-unique behavior - the same shape
  already accepted for unit-02's per-output-local branch of the same tests -
  not a start on unit-05's full sweep. Inspected the 7 Unit 06 test changes
  directly (3 rewritten per the brief's must-fix list, 2 more updated for the
  new reuse semantics, 2 new tests added: cleanup-dispatch idempotency and
  the cross-output Meta+0 reuse+swap interaction) - all correctly exercise
  the new behavior with concrete assertions, not weakened/deleted coverage.
  Lead independently reran typecheck and the full test suite, reproducing
  the Worker's reported result exactly, and independently reran `npm run
  build` to confirm `main.js` is a faithful deterministic regeneration (no
  further diff after rebuild, not hand-edited).
- Files / commit: `kwin/src/controller.ts` (+159/-24 across 9 hunks, lines
  7638-8352 and 8881-9008 old-line ranges), `kwin/tests/controller.test.ts`
  (+189/-93 across 9 hunks: 3 hunks in "dynamic virtual desktops"
  12448-12564, 6 hunks in "global-unique workspaces (Unit 06)" 15482-15719),
  `kwin/contents/code/main.js` (regenerated bundle, verified deterministic).
  No commit (user-only per commit protocol).
- Verification (Lead's own, independent of Worker-reported):
  `npm --prefix kwin run typecheck` -> clean, 0 errors, both tsconfigs. Full
  build+esbuild+`node --test` -> 811 tests, 77 suites, 811 pass, 0 fail
  (809 baseline + 2 new tests), exit 0 - exact match to Worker's reported
  811/811.
- Notes: unit-03 attempt count: 1, accepted first try, no correction round
  (no Attempt Accounting entry needed per governance - only units exceeding
  1 attempt/correction/review are recorded). No commits or pushes. No live
  host action this entry (static verification only). Staged (not committed)
  at end of this dispatch alongside the corresponding `plan.md`/`log.md`
  updates - see Progress/staging note below.

## 2026-08-19 (inv-01, investigation, handover)

- Role / unit: Lead / inv-01 (investigation only, no Worker dispatched -
  bounded, citation-based code reading was sufficient; all reads used
  offset+limit, no whole-file reads of `controller.ts` or
  `controller.test.ts`)
- Result: Investigated a new user ruling that contradicts the settled
  Q-Domain ruling `unit-03` was built to ("a trailing empty on each output;
  Meta+0/Meta+Shift+0 only interact with the currently active/focused
  output's trailing empty"). Findings: `global-unique` mode can structurally
  express the new ruling (existing per-output `globalUniqueAssigned`
  partition plus native per-output current-desktop tracking) but landed
  `unit-03` (`e2105c2`) was built to the old single-global-domain ruling and
  is now flagged superseded, requiring a rework proposed as new unit
  `unit-03b` (not a rewrite of `unit-03`'s own record). `shared` mode cannot
  structurally express the new ruling as stated: `synchronizeShared` forces
  every connected output onto one synchronized current desktop by design,
  so there is no per-output domain or per-output navigation to scope
  Meta+0/Meta+Shift+0 to - escalated as an open product question rather
  than guessed at. `per-output-local` is unaffected (already matches the
  new ruling). No conflict found against the seven listed invariants
  (ownership gating, Q5, Q7, visible-anywhere protection, last-global-
  desktop floor, literal-last-index identification, anti-oscillation
  design), beyond noting the last-index identification's *ordered list*
  changes per domain and the last-desktop floor must stay a whole-session
  check alongside (not instead of) each domain's own never-zero invariant.
  Full findings, draft `spec.md` Q-Domain amendment, proposed unit
  breakdown, and five open questions for the user returned to the
  Orchestrator via chat and recorded in `plan.md` under "inv-01 Findings and
  Proposed Revision (DRAFT)".
- Files / commit: `docs/changes/trailing-empty-workspace/{plan.md,log.md}`
  edited (this entry and the DRAFT findings/proposal section; Work Units and
  Pending User Decisions sections themselves left untouched pending
  Orchestrator approval per plan.md's own governance header). No production
  code touched (`controller.ts`, `controller.test.ts`, `main.js` untouched -
  confirmed by `git status` before finishing). No commit (user-only per
  commit protocol).
- Verification: n/a (investigation only; no code changed, no tests run).
- Notes: No live KWin/Plasma testing performed or required. Terminal status:
  `handover` - this unit's scope (investigation and proposal) is complete;
  the Orchestrator must take the Q-Domain amendment and the five open
  questions to the user before `unit-03b` or `unit-04` can be dispatched.

## 2026-08-19 (Lead succession, spec amendment applied, unit-03b scoping)

- Role / unit: Lead / pre-unit-03b
- Result: New Lead succession. User revised the Q-Domain ruling and the
  Orchestrator approved the amendment (per dispatch brief). Applied the
  revised Q-Domain ruling to `spec.md` Resolved Questions (marked the prior
  Q-Domain entry superseded, added the revised entry verbatim per the
  Orchestrator's approved wording, updated the Acceptance Criteria and
  Consequential Decisions passages that referenced the old single-global-
  domain wording for `global-unique`). Updated `plan.md`: Technical Approach
  "Mode domains" bullet for `global-unique`; added `unit-03b` to the Work
  Units table; marked inv-01's DRAFT findings/proposal section APPROVED
  (historical record, not re-litigated); resolved Pending User Decisions
  (all five of inv-01's open questions answered by the approved ruling);
  Progress updated with a `unit-03b` row. No production code touched yet.
  Confirmed own fresh baseline before any further action: `npm --prefix kwin
  run typecheck` clean (0 errors, both tsconfigs); repository state otherwise
  unchanged since the unit-03 Lead's last verified 811/811 (spec/plan.md-only
  edits do not affect the build).
  Located current global-unique code via targeted, bounded reads (no
  whole-file reads): `enforceGlobalTrailingEmpty`/`resolveGlobalTrailingEmpty`
  (`controller.ts:8986-9044`), `removeOwnedEmptyGlobalUnique`
  (`controller.ts:9049-`), `reconcileGlobalUnique`/`rebuildGlobalUniqueMapping`
  (`controller.ts:8929-8974`), `globalUniqueOrdered`/`assignGlobalUnique`/
  `unassignGlobalUnique` (`controller.ts:8742-8787`), the three reuse call
  sites `finishGlobalWorkspaceZero` (`controller.ts:7705-7725`),
  `finishMoveToTrailing` global-unique branch (`controller.ts:7871-7885`),
  `moveActiveToWorkspace` index-0 branch (`controller.ts:8018-8026`; index>0
  branch at `8041-8049` confirmed unaffected/unchanged),
  `globalUniqueSwapIfVisibleElsewhere` (`controller.ts:8835-8889`),
  `appendDesktopForGlobalUnique` (`controller.ts:8912-8921`), and the mirror
  per-output-local pattern this rework must follow: `enforceLocalTrailingEmpties`
  (`controller.ts:8460-8520`), `resolveLocalTrailingEmpty`
  (`controller.ts:8529-8548`), `appendDesktopForOutputKey`/`appendTrailingForOutput`
  (`controller.ts:8680-8725`). Confirmed `appendDesktopForGlobalUnique(output)`
  already resolves a key and assigns per-output (compatible, unchanged);
  confirmed `resolveGlobalTrailingEmpty`/`enforceGlobalTrailingEmpty` are the
  two methods actually built for the old single-global-domain shape and must
  be reworked. Identified a design nuance for the Worker brief: disconnect
  currently folds a disconnected output's former desktops into the primary
  output's `globalUniqueAssigned` group automatically via
  `rebuildGlobalUniqueMapping` (unchanged, out of scope) - the revised per-
  output `enforceGlobalTrailingEmpty` must not add any special-case logic
  that deliberately preserves that folded-in desktop as the primary's
  protected trailing; plain structural last-position identification (already
  the enforced design elsewhere) is sufficient and requires no new code, but
  needs an explicit regression test, not just reasoning. Confirmed no orphan
  sweep should be needed (every live desktop always lands in exactly one
  connected output's `globalUniqueAssigned` group via the unconditional
  fallback-to-primary loop in `rebuildGlobalUniqueMapping`), but the Worker
  brief requires this to be verified, not assumed, per inv-01's instruction.
  Identified that `finishGlobalWorkspaceZero` does not currently call
  `reconcileGlobalUnique` before resolving (unlike `finishLocalWorkspaceZero`,
  which calls `rebuildLocalMapping(desktops)` first), and neither does
  `finishMoveToTrailing`'s global-unique branch or `moveActiveToWorkspace`'s
  index-0 branch (unlike their per-output-local siblings, which call
  `rebuildLocalMapping()`) - now that the domain is assignment-based rather
  than whole-list-based, mapping freshness at each call site matters; the
  Worker brief requires mirroring per-output-local's rebuild-before-resolve
  pattern at all three call sites. Located the "TileController global-unique
  workspaces (Unit 06)" describe block bounds (`controller.test.ts:15285-15741`,
  16 `it(...)` cases) and identified by name which currently encode the old
  single-global-domain/cross-output-swap-adoption model and need rewriting or
  removal (notably "Meta+0 reuse applies the cross-output swap when the
  global trailing empty is currently shown on a different output" - this
  exact behavior is now forbidden and the test must be replaced with a
  negative assertion that the swap never fires on the trailing-empty path).
- Files / commit: `docs/changes/trailing-empty-workspace/{spec.md,plan.md,
  log.md}` only. No source files touched. No commit (user-only per commit
  protocol).
- Verification: `npm --prefix kwin run typecheck` (clean, both tsconfigs);
  no test run this entry (no production code changed yet).
- Notes: No commits, staging, or pushes performed. No live host action this
  entry. Dispatching a fresh `worker-anthropic` next, scoped to `unit-03b`
  per the brief above: `enforceGlobalTrailingEmpty`, `resolveGlobalTrailingEmpty`,
  the three reuse call sites, a new key-based append helper mirroring
  `appendDesktopForOutputKey`, and the "global-unique workspaces (Unit 06)"
  describe block only. `unit-02`'s per-output-local code and tests are out of
  scope and must not be touched.

## 2026-08-19 (unit-03b, attempt-1, accepted)

- Role / unit: Lead / unit-03b, attempt-1 (worker-anthropic)
- Result: Accepted, no correction round needed. Dispatched `worker-anthropic`
  scoped to global-unique mode only per the brief above. Worker rewrote
  `enforceGlobalTrailingEmpty()` to loop `connectedOutputKeys()` and enforce
  the trailing-empty invariant once per key using `globalUniqueOrdered(desktops,
  key)` as that key's domain (mirroring `enforceLocalTrailingEmpties()`
  exactly); changed `resolveGlobalTrailingEmpty()`'s signature to
  `(output: OutputCapability)`, resolving within that output's own
  `globalUniqueOrdered` group only; added a new key-based
  `appendDesktopForGlobalUniqueKey(key)` primitive and refactored the
  existing `appendDesktopForGlobalUnique(output)` to delegate to it
  (mirroring `appendDesktopForOutputKey`/`appendTrailingForOutput`); removed
  the `globalUniqueSwapIfVisibleElsewhere` call from all three trailing-empty
  reuse call sites (`finishGlobalWorkspaceZero`, `finishMoveToTrailing`
  global-unique branch, `moveActiveToWorkspace` index-0 global-unique
  branch), leaving the helper's only remaining call sites the unchanged
  `index > 0` navigation/move-follow branches; added mapping-freshness
  rebuild calls (`reconcileGlobalUnique`) at all three reuse call sites,
  mirroring per-output-local's existing `rebuildLocalMapping()` calls at the
  same three sites (now needed because the domain is assignment-based, not
  whole-list-based). No orphan sweep was added - the Worker independently
  verified by reading `rebuildGlobalUniqueMapping` that it unconditionally
  folds every unassigned live desktop into the primary output's group
  whenever at least one output is connected, so no desktop can fall outside
  every domain.
  Lead inspected the actual diff directly (not the summary): confirmed all 8
  hunks in `controller.ts` (old-line ranges 7694-8033 and 8907-9057) fall
  entirely within the declared scope (the three call sites, the two rewritten
  methods, the new key-based append primitive, and their doc comments);
  confirmed zero `ownedDesktopIds` references anywhere in the diff for either
  `controller.ts` or `controller.test.ts` (direct `git diff | grep
  ownedDesktopIds` empty, the one remaining occurrence in the test diff is
  the pre-existing, unchanged `ownedDesktopIdSnapshot()` accessor) - no
  reintroduction of the ownership-gating defect class. Confirmed
  `per-output-local` and `shared` code/tests are untouched (all 7 test hunks
  fall entirely within the "global-unique workspaces (Unit 06)" describe
  block, 15285-15778). Inspected the rewritten/added tests directly: the
  disconnect regression ("cleanup removes every empty, invisible desktop
  after a disconnect, including the disconnected output's former trailing
  empty, but reserves the surviving output's own trailing empty") correctly
  exercises the "not adopted" ruling in the concrete tested scenario (the
  disconnected output's former trailing, `desktop-7`, gets folded into the
  surviving output's group by the unchanged `rebuildGlobalUniqueMapping`, but
  is swept because the surviving output's own `desktop-8` remains
  structurally last, not `desktop-7`); the new "Meta+0 never applies the
  cross-output swap on the trailing-empty reuse path..." test asserts zero
  `workspace-navigate-swap` events and that the other output's current
  desktop and assignment are left completely untouched; the new "a newly
  connected output gets a freshly created trailing empty, never an adopted
  spare desktop" test asserts exactly one new `createDesktop` call. Noted (not
  a defect, a documented design property inherent to the existing
  literal-last-index structural-identification rule used everywhere in this
  change, unchanged by this unit): if a disconnected output's former trailing
  happened to carry a *higher* `x11DesktopNumber` than the surviving output's
  own true trailing, pure structural last-position identification would
  protect it instead - this is the same "whichever is literal-last wins"
  property Q-Manual already relies on throughout the codebase, not a gap
  introduced here, and is not tested as a separate adversarial case; flagged
  for awareness, not a blocking finding.
  Lead independently reran typecheck (clean, both tsconfigs) and the full
  build+esbuild+`node --test` suite, reproducing the Worker's reported
  813/813 exactly (811 baseline + net 2: -1 removed "cross-output swap"
  test, +3 added). Lead independently reran `npm run build` a second time and
  confirmed `main.js` regenerates byte-identically (identical diff before and
  after), confirming it is a faithful, deterministic bundle, not hand-edited.
- Files / commit: `kwin/src/controller.ts` (+135/-135 net across 8 hunks),
  `kwin/tests/controller.test.ts` (+129 net, entirely within the "global-unique
  workspaces (Unit 06)" describe block), `kwin/contents/code/main.js`
  (regenerated bundle, verified deterministic). No commit (user-only per
  commit protocol).
- Verification (Lead's own, independent of Worker-reported):
  `npm --prefix kwin run typecheck` -> clean, 0 errors, both tsconfigs. Full
  build+esbuild+`node --test` -> 813 tests, 77 suites, 813 pass, 0 fail,
  exit 0 - exact match to Worker's reported 813/813.
- Notes: unit-03b attempt count: 1, accepted first try, no correction round
  (no Attempt Accounting entry needed per governance). No commits or pushes.
  No live host action this entry (static verification only). Staged (not
  committed) alongside `kwin/src/controller.ts`,
  `kwin/tests/controller.test.ts`, `kwin/contents/code/main.js`,
  `docs/changes/trailing-empty-workspace/{spec.md,plan.md,log.md}` - see
  Staging Note in `plan.md`. Terminal status for this dispatch: `accepted`.

## 2026-08-19 (Lead succession, unit-04 scoping and dispatch, accepted)

- Role / unit: Lead / unit-04, attempt-1 (worker-anthropic)
- Result: New Lead succession. Confirmed `unit-03b` already committed by the
  user (`git log` shows `HEAD` at `7c28759 feat(workspace): scope
  global-unique trailing empty to each output`, working tree clean except the
  three pre-excluded untracked paths) - reconciled the stale
  "not yet committed" staging note in `plan.md` accordingly. Own fresh
  baseline: `npm --prefix kwin run typecheck` clean (0 errors, both
  tsconfigs).
  Investigated `shared` mode's exact code shape via targeted, bounded reads
  (no whole-file reads): `synchronizeShared`/`synchronizeSharedCurrent`/
  `rebuildSharedMapping`/`navigateShared` (`controller.ts:7528-7636`),
  `finishWorkspaceZero`/`finishSharedWorkspaceZero`
  (`controller.ts:7648-7769`), `finishMoveToTrailing`
  (`controller.ts:7844-7909`, shared branch always called `appendDesktop()`
  unconditionally), `moveActiveToWorkspace`
  (`controller.ts:7975-8082`, shared's index-0 branch likewise always
  created - its own comment explicitly flagged this as "unit-04, unchanged
  here"), `cleanupDesktops`/`cleanupEligibleDesktops`/`removeOwnedEmptyShared`
  (`controller.ts:8290-8425`, shared's only removal path, via
  `planDesktopCleanup`, with no trailing-empty protection at all), and the
  mirror pattern in `enforceGlobalTrailingEmpty`/`resolveGlobalTrailingEmpty`
  (`controller.ts:8985-9057`). Confirmed `shared` needs exactly one global
  domain (the entire live desktop list), no per-output split, and
  `synchronizeShared` itself needs no change (matches spec.md's Q-Domain
  ruling for shared exactly). Found `cleanupEligibleDesktops()`/the
  `planDesktopCleanup` import would become fully dead in `controller.ts`
  once shared switches to the domain-based helper (single remaining caller,
  confirmed by grep) - since `noUnusedLocals: true` flags unused private
  class members, removing both is a mechanically required consequence of the
  wiring, not optional scope creep; confirmed `planDesktopCleanup`'s own
  definition/types in `logic.ts` and its independent unit tests in
  `tests/logic.test.ts` are unaffected (different import path, untouched).
  Located the "TileController shared workspaces (Unit 07)" describe block
  (`controller.test.ts:15778-16202`, ~17 `it(...)` cases) and, via targeted
  grep and one bounded read of `configureSwitchCleanupScenario`/
  `modeCleanupSetup`, identified three shared-only tests outside that block
  (in "TileController dynamic virtual desktops",
  `controller.test.ts:12425-12484`/`12566-12580`/`12627-12655`) that directly
  assert the old "no reserved trailing capacity" premise for shared mode
  specifically - determined these are this unit's own scope (not unit-05's
  cross-mode sweep) since they are mode-specific and directly contradict the
  exact invariant this unit adds.
  Dispatched `worker-anthropic` with a fully prescriptive design (exact
  method bodies for `enforceSharedTrailingEmpty`, `resolveSharedTrailingEmpty`,
  `isCurrentShared`, `appendDesktopForShared`, and exact rewritten call sites)
  mirroring `enforceGlobalTrailingEmpty`/`resolveGlobalTrailingEmpty`'s shape
  collapsed to a single domain, per the project's established practice of
  specifying precisely rather than leaving design to Worker invention.
  Worker reported `review-ready`: added the four new methods; rewrote
  `finishSharedWorkspaceZero`, the shared branches of `finishMoveToTrailing`
  and `moveActiveToWorkspace`'s index-0 case, and `cleanupDesktops`'s shared
  branch exactly as specified; deleted `cleanupEligibleDesktops()` and the
  `planDesktopCleanup` import; rewrote the "shared workspaces (Unit 07)"
  block (four "always create" tests converted to reuse+replenish tests, one
  new explicit Q-Zero no-op test, one new explicit idempotency test) and the
  three named cross-block tests.
  Lead inspected the actual diff directly (not the summary): confirmed all 7
  `controller.ts` hunks (old-line ranges 40, 7752-8448) fall entirely within
  the declared shared-mode scope, none touching `per-output-local`/
  `global-unique` code; confirmed the new methods, rewritten call sites, and
  deleted dead code match the prescribed design exactly (read the full
  production diff, not excerpts); confirmed zero `ownedDesktopIds` hits in
  the diff of either `controller.ts` or `controller.test.ts` (direct `git
  diff ... | grep ownedDesktopIds`, empty) - no ownership-gating
  reintroduction; confirmed `removeOwnedEmptyShared` and
  `ensureTrailingEmptyDesktop` (unit-01) are unmodified; confirmed no orphan
  sweep was added (correctly - shared's domain is definitionally the entire
  live list, so no desktop can fall outside it, matching the reasoning
  already accepted for global-unique's original single-domain shape).
  Inspected all 12 `controller.test.ts` hunks directly: confirmed the three
  named cross-block fixes correctly reverse their prior "no reserved
  capacity"/"removes desktop-trailing" assertions to the new
  protect-the-trailing-position behavior with concrete, non-weakened
  assertions (including new `sharedWorkspaceSnapshot()` checks matching the
  other two modes' precedent), and confirmed all hunks in the Unit 07 block
  stay within its own bounds, with no other test block touched.
  Lead independently reran `npm --prefix kwin run typecheck` (clean, both
  tsconfigs) and the full build+esbuild+`node --test` suite, reproducing the
  Worker's reported 815/815 (0 fail) exactly, and independently reran `npm
  run build` a second time, confirming `main.js` regenerates with no further
  diff (deterministic, not hand-edited).
- Files / commit: `kwin/src/controller.ts` (+181/-136 net across 7 hunks),
  `kwin/tests/controller.test.ts` (+159/-124 net across 12 hunks),
  `kwin/contents/code/main.js` (regenerated bundle, verified deterministic).
  No commit (user-only per commit protocol).
- Verification (Lead's own, independent of Worker-reported):
  `npm --prefix kwin run typecheck` -> clean, 0 errors, both tsconfigs. Full
  build+esbuild+`node --test` -> 815 tests, 77 suites, 815 pass, 0 fail,
  exit 0 - exact match to Worker's reported 815/815.
- Notes: unit-04 attempt count: 1, accepted first try, no correction round
  (no Attempt Accounting entry needed per governance). No commits or pushes.
  No live host action this entry (static verification only) - per the
  standing instruction, `unit-04` was deliverable with static tests only and
  no live-host action was needed or taken. Staged (not committed):
  `kwin/src/controller.ts`, `kwin/tests/controller.test.ts`,
  `kwin/contents/code/main.js` - see Staging Note in `plan.md`. Terminal
  status for this dispatch: `accepted`.
- **Post-hoc caveat (added by the reconciling successor Lead below): this
  dispatching Lead was cancelled mid-flight by quota exhaustion before
  returning any report to the Orchestrator. Everything in this entry above
  was written before that cancellation and was unconfirmed until the
  reconciliation entry below independently re-verified it.**

## 2026-08-19 (Lead succession, unit-04 reconciliation after mid-flight cancellation)

- Role / unit: Lead / unit-04, attempt-01 (reconciliation, no Worker
  dispatched - the cancelled dispatch's surviving artifacts were verified
  directly)
- Result: Accepted. New Lead succession following the prior Lead's mid-flight
  quota cancellation (no report ever reached the Orchestrator). Read
  `docs/live-kwin-testing.md`, took a fresh, own, non-inherited live desktop
  baseline before any other action: `busctl --user` read of
  `org.kde.KWin.VirtualDesktopManager.desktops` returned exactly 4 desktops
  matching the confirmed baseline by ID and name (`392a73ad` "Desktop 1",
  `ec13f70f` "Desktop 3", `41cee7be` "Desktop 4", `dd68d41e` "4") - no
  populated desktop missing, no more than one extra. Noted (not an incident
  per the defined criteria, since no desktop is missing and there is not
  more than one extra): no additional trailing-empty desktop is currently
  present, unlike the "one extra expected" baseline description - most
  likely because the currently live-installed script is a build of committed
  `HEAD` (`7c28759`, pre-unit-04), and unit-04's shared-mode wiring is only
  staged, not yet installed live. `bash scripts/dogfood-install.sh status`
  confirmed installed/enabled, read-only, no mutation performed or
  attempted; plugin left installed and enabled per instruction.
  Treated the cancelled Lead's `log.md`/`plan.md` unit-04 entries (written
  before cancellation, describing a `review-ready` Worker dispatch and full
  Lead verification) as unverified record-keeping, not evidence, per
  instruction. Independently re-established every claim from the actual
  artifacts rather than trusting the record:
  - `git diff --cached -- kwin/src/controller.ts` (249 lines) and
    `kwin/tests/controller.test.ts` (279 lines) read directly in full (both
    bounded, well under any whole-file read). Confirmed all `controller.ts`
    hunks (old-line ranges 40, 7752-8460) and all `controller.test.ts` hunks
    (three named locations in "TileController dynamic virtual desktops"
    12467-12643, plus the entire "TileController shared workspaces (Unit
    07)" block 15928-16222) fall within shared-mode scope only; zero hits
    for `ownedDesktopIds` in either diff (only the pre-existing, unchanged
    `ownedDesktopIdSnapshot()` test accessor is used, not touched); confirmed
    `ensureTrailingEmptyDesktop` (unit-01, `controller.ts:~1651-1719`) and
    every `per-output-local`/`global-unique` method (`enforceLocalTrailingEmpties`,
    `resolveLocalTrailingEmpty`, `enforceGlobalTrailingEmpty`,
    `resolveGlobalTrailingEmpty`, `globalUniqueSwapIfVisibleElsewhere`, etc.)
    are entirely absent from the diff, i.e. untouched; confirmed
    `enforceSharedTrailingEmpty`/`resolveSharedTrailingEmpty` operate on the
    single entire live desktop list with no loop over `connectedOutputKeys()`
    - i.e. the per-output design from unit-02/unit-03b was not imported into
    `shared` mode, matching spec.md's Q-Domain ruling that `shared` keeps one
    global trailing empty. `synchronizeShared` itself is called but its own
    definition is absent from the diff (unmodified).
  - `npm --prefix kwin run typecheck` -> clean, 0 errors, both tsconfigs
    (independently rerun, not inherited).
  - Full `devenv shell --impure -- bash -c "cd kwin && npm run build && rm
    -rf dist/tests && esbuild 'tests/*.test.ts' --bundle --platform=node
    --format=cjs --target=es2020 --outdir=dist/tests && node --test
    'dist/tests/**/*.test.js'"` -> 815 tests, 77 suites, 815 pass, 0 fail,
    exit 0. Exact match to the unverified record's claim. Delta vs. the
    813/813 baseline at HEAD `7c28759` (confirmed pre-existing from
    unit-03b's own independently-verified acceptance): +2, both new tests
    added within the "shared workspaces (Unit 07)" block (Q-Zero no-op test,
    repeated-cleanup-idempotency test) per the diff read above - fully
    accounted for, no unexplained delta.
  - Reran `npm run build` a second time after the test run above; `git diff
    -- kwin/contents/code/main.js` (unstaged) returned zero lines - `main.js`
    regenerates byte-identically to the already-staged copy, confirming a
    faithful, deterministic bundle, not hand-edited.
  - Design correctness against the unit's actual requirement (one GLOBAL
    trailing empty for `shared`, not per-output): confirmed directly in the
    diff - `enforceSharedTrailingEmpty()` reads `this.liveDesktops()` as one
    flat ordered list and calls `ensureTrailingEmptyDesktop()` exactly once
    (no per-output loop); `resolveSharedTrailingEmpty()` resolves against the
    same flat list; `isCurrentShared()` reads the single global current
    desktop via `this.environment.currentDesktop()`, not a per-output read
    (unlike `isCurrentOnOutput`'s per-output-local counterpart).
  No corrections were needed and no new Worker was dispatched - the
  cancelled dispatch's surviving artifacts were, once independently verified
  rather than trusted, already correct and complete.
- Files / commit: `docs/changes/trailing-empty-workspace/{plan.md,log.md}`
  (this entry and the corresponding Attempt Accounting / Progress / Staging
  Note updates in `plan.md`). No source files touched or changed by this
  Lead - `kwin/src/controller.ts`, `kwin/tests/controller.test.ts`, and
  `kwin/contents/code/main.js` remain exactly as staged by the cancelled
  dispatch, independently confirmed correct. No commit (user-only per commit
  protocol).
- Verification: `npm --prefix kwin run typecheck` (clean, both tsconfigs,
  independently rerun); full `node --test` run, 815/815 pass, 0 fail
  (counts only, independently rerun); `main.js` rebuild diff: 0 lines
  (independently rerun a second time).
- Notes: unit-04 attempt count: 1 (the cancelled dispatch and this
  reconciliation together constitute attempt-01; no second Worker dispatch
  or code change was needed, so this is not attempt-02). Recorded in Attempt
  Accounting per explicit instruction despite not exceeding 1 attempt/
  correction/review, given the mid-flight cancellation. No commits, staging
  changes beyond `plan.md`/`log.md`, or pushes performed by this Lead - the
  three source files were already staged by the cancelled dispatch and are
  left staged unchanged. Terminal status for this dispatch: `accepted`.
