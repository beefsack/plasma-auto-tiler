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

## 2026-08-19 (Lead succession, unit-07 reconciliation and diagnosis)

- Role / unit: Lead / unit-07, attempt-01 reconciliation, then pre-unit-07
  attempt-02 diagnosis (no Worker dispatched yet - bounded, citation-based
  code reading only; every read used offset+limit, no whole-file read of
  `controller.ts` or `controller.test.ts`)
- Result: New Lead succession dispatched directly onto unit-07 (a new unit,
  not previously in `plan.md`'s Work Units table). Found an uncommitted,
  unstaged, cancelled-mid-flight partial edit with zero record in either
  `log.md` or `plan.md`: a 6-line change to `kwin/src/controller.ts` (plus
  the matching `main.js` bundle rebuild) that replaced each of the three
  `cleanupDesktops()` single-desktop-degeneracy guard conditions
  (`desktops.length <= 1 && ...`) with `(false && desktops.length <= 1) &&
  ...`, unconditionally disabling all three guards via a dead-code
  short-circuit, with no comment update, no test change, and no reasoning
  recorded anywhere. Read the diff directly (bounded, `git diff --
  kwin/src/controller.ts`, 6 lines) rather than the whole file. Judged this
  a debug/exploratory disable, not a finished or considered fix: the
  mechanism (`false &&`) is not a pattern this codebase uses anywhere else
  to express "always take this branch," it left the now-inaccurate D1
  comment in place unedited, and it added no tests or record - inconsistent
  with every other accepted unit in this change, which always paired a
  guard change with updated comments, tests, and a log entry. Discarded via
  `git checkout -- kwin/src/controller.ts kwin/contents/code/main.js`;
  confirmed clean tree afterward (`git status --short` shows only the three
  pre-excluded untracked paths). This decision was made independently of
  whether the edit's *location* was correct (it was, see below) - a correct
  location reached via unreasoned means, with no record, is still discarded
  per instruction ("do not silently keep it").
- Independently established the root cause from the code, per the
  Orchestrator's brief instruction to verify rather than assume the "not
  wired into window-add events" hypothesis: **that hypothesis is false**.
  `handleWindowAdded` (`controller.ts:4418-4454`) already calls
  `this.cleanupDesktops()` unconditionally on every window-add dispatch
  (`controller.ts:4451`), confirmed by direct bounded read - window-add was
  never unwired. The actual defect is the pre-existing (predates this whole
  change; comment cites "Spec D1" from the archived
  `2026-08-14-multi-output-workspaces-and-shortcuts` change, confirmed by
  reading that spec's D1 section directly) `cleanupDesktops()` early-return
  guard, present once per mode branch (`controller.ts:8337-8365`, all three
  read directly): `if (desktops.length <= 1 && this.connectedOutputKeys().length
  <= 1) { return; }` for `per-output-local`/`global-unique`, and `if
  (desktops.length <= 1) { return; }` for `shared` (no output-count
  qualifier). All three unconditionally skip `reconcile*`/`enforce*Trailing
  Empty()` entirely whenever the live desktop count is exactly 1 (plus,
  for the first two, only one connected output) - with no occupancy check.
  So the very first window ever placed directly onto a lone pre-existing
  desktop (no prior Meta+0/Meta+Shift+0, which is exactly the user's
  reproduction: fresh session, one desktop, opened a terminal in it
  directly) never triggers append, in any of the three modes, because
  `cleanupDesktops()` returns before ever calling the enforcement functions
  that would notice the occupancy. Confirmed this is safe to simply remove
  (not merely narrow) by reading `enforceLocalTrailingEmpties`
  (`controller.ts:8519-8557`) and `enforceSharedTrailingEmpty`
  (`controller.ts:8378-8406`) directly: both call the unit-01
  `ensureTrailingEmptyDesktop` helper, whose own structural
  last-position-if-empty check already no-ops correctly for the
  single-empty-desktop startup case (step 1 of the live repro, which must
  stay a no-op per the Orchestrator's brief) - the guard adds no behavior
  the helper does not already provide correctly, it only actively breaks
  the occupied case. Confirmed via a second bounded read
  (`controller.test.ts:13486-13519`, "an occupancy event on the trailing
  empty appends its replacement (COSMIC-style reuse)") that this exact
  occupancy-append behavior already has passing test coverage today, but
  only because that test's setup (`ownTrailingEmpty`) always creates a
  second desktop first via Meta+Shift+0 before the occupancy event - so the
  live desktop count is 2, not 1, at the moment of occupancy, entirely
  sidestepping the buggy guard. This explains why 815/815 existing tests
  pass despite the live defect: no existing test exercises "a window
  occupies the *sole* pre-existing desktop with no prior owned-desktop
  creation," in any of the three modes.
  Also identified, by reading `modeCleanupSetup()` (`controller.test.ts:
  682-700`) and its one parametrized caller (`controller.test.ts:
  12425-12484`), that this helper places a window on the tile system
  *before* `controller.start()`, with the Harness's single-output/
  single-desktop defaults (`OUTPUT`/`DESKTOP`, `controller.test.ts:46-53,
  248,250`) - i.e. removing the guard will newly cause `controller.start()`
  itself to append a trailing-empty replacement during that test's setup
  phase, for all three modes, before that test's own `configureSwitch
  CleanupScenario` helper overwrites `harness.desktopsList` wholesale.
  Reasoned through (not yet verified by an actual test run) that this
  specific test's own assertions are likely unaffected, since the
  wholesale list overwrite discards whatever `createDesktop` call happened
  at startup and the subsequent mapping rebuild re-derives cleanly from the
  post-overwrite live list - flagged as the primary thing to confirm by
  running the actual suite, not by further static reading, to avoid
  over-spending context on hand-verification the test run will settle
  directly and authoritatively.
  No conflict found against the approved anti-oscillation design: this fix
  adds no new call site, no new dispatcher trigger, no caching, no
  debounce/timer - it only removes a special-cased short-circuit that was
  incorrectly preventing the *already-existing, already-idempotent*
  `ensureTrailingEmptyDesktop` enforcement path from running on the single
  dispatch event (window-add) where it was needed. Since that helper's own
  step 3 (append-only-if-the-post-removal-invariant-is-actually-violated)
  is unchanged and was already proven idempotent at unit-01/02/03b/04, and
  since the guard removal does not change how often `cleanupDesktops()`
  itself is invoked (only whether, once invoked, the mode branch actually
  does its work), there is no new oscillation surface: a dispatch that
  changes nothing still produces zero creates/removes for the same reason
  it always did, and the single desktop boundary case simply stops being
  wrongly special-cased out of that existing guarantee.
- Files / commit: `docs/changes/trailing-empty-workspace/{plan.md,log.md}`
  only (this entry, the new unit-07 Work Units row, Progress row, and
  Attempt Accounting entry). `kwin/src/controller.ts`/`kwin/contents/code/
  main.js` reverted to committed `HEAD` (`fa0e4a3`) via `git checkout --`;
  no other source files touched. No commit (user-only per commit protocol).
- Verification: n/a for this entry (diagnosis and record-keeping only; no
  code changed by the Lead). Own fresh baseline re-confirmed before this
  diagnosis: `git status --short` clean except the three pre-excluded
  untracked paths, `HEAD` at `fa0e4a3`, matching the Orchestrator's stated
  starting state exactly.
- Notes: No commits, staging, or pushes performed. No live host action this
  entry (static diagnosis only). Dispatching a fresh `worker-anthropic`
  next, scoped to: `cleanupDesktops()` only (`controller.ts:8309-8368`) -
  delete the three early-return guards and their now-stale comments,
  changing nothing else in the method; run the full suite and fix only
  tests that fail as a direct, reported consequence (naming each, and
  classifying it as a stale pre-fix assumption vs. a genuine gap, not
  guessed at); add one new, narrowly-bounded describe block with explicit
  regression coverage for the exact live sequence (single desktop, occupy
  it, append exactly one; occupy the replacement, append exactly one more)
  in all three modes, plus an explicit idempotency check at the n=1
  boundary specifically. unit-07 attempt count: 2 (attempt-01 cancelled
  mid-flight with no report, per the Orchestrator's brief this counts as a
  full attempt; this dispatch is attempt-02).

## 2026-08-19 (unit-07, attempt-02, accepted)

- Role / unit: Lead / unit-07, attempt-02 (worker-anthropic)
- Result: Accepted, no correction round. Dispatched `worker-anthropic`
  scoped to `cleanupDesktops()` (`controller.ts:8309-8368`) only: delete
  the three early-return guards and their stale comments, run the full
  suite, fix only tests that fail as a direct reported consequence, and add
  one new narrowly-bounded regression describe block for the live sequence.
  Worker reported `review-ready`: production diff is exactly the specified
  deletion (one hunk, `cleanupDesktops()` only, -18 lines, nothing else
  touched); 12 pre-existing tests needed precondition restoration (more
  than the Lead's brief specifically flagged - the Lead had called out 1
  test by name as the primary risk and asked the Worker to investigate
  rather than assume for the rest, which the Worker did), all traced to the
  same root cause: `setup()`'s pre-attached focused window genuinely
  occupies the sole startup desktop, so the fix now correctly appends and
  owns a replacement trailing empty during `controller.start()` itself,
  invalidating each affected test's prior "nothing created yet"
  precondition; one new describe block, "TileController trailing-empty
  invariant on first occupation (Unit 07 live regression)", 12 `it()` cases
  (4 per mode across the 3 modes: empty-start no-op, first-occupation
  append, second-occupation append-with-survival, post-settle idempotency).
  Lead inspected the actual diff directly (not the summary): confirmed the
  `controller.ts` diff is exactly the deletion specified in the brief, one
  hunk, no other method touched; confirmed zero `ownedDesktopIds` hits
  anywhere in either file's diff (direct `git diff -- kwin/src/controller.ts
  kwin/tests/controller.test.ts | grep ownedDesktopIds`, empty); read all 12
  fallout fixes directly and confirmed each restores a precondition (a
  stale create-count reset after a wholesale list overwrite, or a bare
  `Harness` replacing `setup()` with `createDesktopThrows` set before
  `start()` so the first, now-legitimate startup append attempt is the one
  that fails) rather than weakening or deleting any assertion, and that the
  same root cause explains all 12 consistently; read the new describe
  block's fixture (`singleDesktopModeSetup`) and all 12 new cases directly,
  confirmed they exercise the exact live-repro sequence (steps 1/2/5/6 of
  the Orchestrator's brief) with concrete assertions on `createDesktopCalls`
  count, the live desktop-id list, and each mode's own snapshot accessor
  (`localWorkspaceSnapshot`/`globalUniqueAssignmentSnapshot`/
  `sharedWorkspaceSnapshot`), plus an explicit idempotency case per mode.
  Lead independently reran `npm --prefix kwin run typecheck` (clean, both
  tsconfigs) and the full build+esbuild+`node --test` suite, reproducing
  827 tests, 78 suites, 827 pass, 0 fail exactly (815 baseline + 12 new).
  Lead independently verified `main.js` determinism properly (not by
  checking for a zero `git diff`, which always compares against pre-fix
  `HEAD` and would never be zero here): copied the post-fix `main.js`
  aside, ran `npm run build` a second time, and diffed the two builds
  directly - zero difference, confirming a faithful, deterministic
  regeneration, not hand-edited.
- Files / commit: `kwin/src/controller.ts` (-18 lines, one hunk,
  `cleanupDesktops()` only), `kwin/tests/controller.test.ts` (+245/-40 net,
  ~15 hunks: 10 precondition-restoration fixes in "TileController dynamic
  virtual desktops", 2 in "TileController per-output-local workspaces (Unit
  05)", 1 new describe block appended after "TileController shared
  workspaces (Unit 07)"), `kwin/contents/code/main.js` (regenerated bundle,
  independently verified deterministic). Committed and pushed by this Lead
  per the updated commit protocol - see commit hash below.
- Verification (Lead's own, independent of Worker-reported):
  `npm --prefix kwin run typecheck` -> clean, 0 errors, both tsconfigs.
  Full build+esbuild+`node --test` -> 827 tests, 78 suites, 827 pass, 0
  fail, exit 0 - exact match to Worker's reported 827/827. `main.js`
  determinism independently verified via a direct two-build diff (zero
  difference).
- Notes: unit-07 attempt count: 2 (attempt-01 cancelled mid-flight with no
  report, treated as a full attempt per the Orchestrator's brief; attempt-02
  accepted first try within itself, no correction round needed - the
  breaker is not tripped and has full headroom, no further dispatch on this
  unit expected unless a defect surfaces later). No live host action this
  entry (static verification only, per brief - this unit was fully
   deliverable with static tests, no live confirmation was required to reach
   acceptance). Terminal status for this dispatch: `accepted`. Committed and
   pushed at `cb9b121 fix(workspace): append replacement trailing empty on
   first desktop occupation` (`fa0e4a3..cb9b121`), confirmed via `git push`
   output, including the `docs/changes/trailing-empty-workspace/` process
   artifacts alongside the code, per explicit instruction not to leave them
   untracked.

## 2026-08-20 (unit-05, core deliverables accepted)

- Role / unit: Lead / unit-05 (three `worker-anthropic` slices, attempt-01
  each, no correction rounds)
- Result: Verified own fresh baseline first: `HEAD` at `cb9b121`, working
  tree clean except the three pre-excluded untracked paths, 827/827 tests
  pass, typecheck clean on both tsconfigs, `scripts/dogfood-install.test.sh`
  336/336. Read `spec.md` and `plan.md` in full for unit-05's declared
  scope, then audited both declared describe blocks
  ("TileController dynamic virtual desktops",
  "TileController workspace mode and per-output seams (Unit 04)") directly:
  found the spec's ~34 "always create, never reuse, no reserved capacity"
  stale assertions were already corrected as fallout of units 02/03/03b/04/
  07's own precondition-restoration fixes before this unit started - a scope
  reconciliation finding, not new work; the only remaining "always creates"
  test title found anywhere in the file
  (`controller.test.ts:15364`, "Meta+0 always creates a new desktop on the
  active output only...") sits in the per-output-local block, out of
  unit-05's declared file scope, and is stale wording on an otherwise-
  correct, spec-compliant assertion (create-only-when-absent) - left
  untouched, reported rather than silently fixed. Dispatched three
  `worker-anthropic` slices in series, each scoped to exactly one describe
  block, each individually diff-inspected directly by the Lead afterward
  (not the Worker's summary): (1) adversarial global-unique disconnect
  ordering test (routed from unit-03b) in the "global-unique workspaces
  (Unit 06)" block; (2) Q-MultiOutput non-confusability test in the
  "per-output-local workspaces (Unit 05)" block; (3) mixed-dispatcher-
  trigger-type oscillation test, one case per mode via the existing
  mode-loop idiom, in the "TileController dynamic virtual desktops" block.
  All three diffs confirmed pure additions (0 deletions, 212 insertions
  total across all three, `git diff --stat` independently run after each),
  confined to their declared single describe block, zero `ownedDesktopIds`
  references, no production code (`kwin/src/controller.ts`) touched. Also
  performed the state-space unreachability enumeration requested as this
  unit's most important input (see `plan.md` Acceptance-Criterion Evidence
  for the full write-up): classified existing fixtures into
  fixture-literal-constructed-state versus grown-through-real-operations,
  and found new, not-yet-covered reachability gaps (no 3+-simultaneous-
  output scenario for `per-output-local`/`shared`, no disconnect-from-three
  case anywhere, no replug test for `global-unique`/`shared`) - reported to
  the Orchestrator as a scope question, not silently added to this unit's
  own dispatch given the Lead's return threshold, and no equivalent
  locatable code branch (unlike unit-07's guard) was found gating on those
  conditions during this unit's own reads of `rebuildGlobalUniqueMapping`/
  `SessionOutputKeys`/`enforceLocalTrailingEmpties`, so this is reported as
  a coverage gap, not a confirmed defect.
- Files / commit: `kwin/tests/controller.test.ts` (+212/-0 across three
  additive hunks, one per describe block; no other production or test
  region touched), `kwin/contents/code/main.js` confirmed byte-identical to
  committed `HEAD` (test-only change, independently verified via
  `git diff --stat -- kwin/contents/code/main.js` showing no diff after a
  fresh `npm run build`), `docs/changes/trailing-empty-workspace/
  {plan.md,log.md}` (this entry and the Progress/Acceptance-Criterion-
  Evidence/Residual-Risks updates). Committed and pushed by this Lead per
  the commit protocol - see commit hash below.
- Verification (Lead's own, independent of each Worker's own reported
  count): full build+esbuild+`node --test` -> 832 tests, 78 suites, 832
  pass, 0 fail (827 baseline + 5 new: 1 adversarial, 1 Q-MultiOutput, 3
  mixed-trigger oscillation cases). `npm --prefix kwin run typecheck` ->
  clean, both tsconfigs.
  `devenv shell --impure -- bash -c "cd scripts && bash
  dogfood-install.test.sh"` -> 336/336, unchanged from baseline (no
  install-path files touched this unit).
- Notes: unit-05 marked partial (`[~]`) in Progress, not closed. The three
  explicitly-dispatched-brief deliverables (adversarial ordering,
  Q-MultiOutput, oscillation) are accepted with no correction round; the
  unit is left open pending an Orchestrator decision on the newly
  discovered 3+-output/replug reachability gaps (additional unit-05 slice,
  a new follow-up unit, or accepted residual risk). Live-runtime oscillation
  remains an unverified residual risk regardless of the new static
  coverage - a concrete live-check proposal (three scenarios, journalctl-
  monitored) is recorded in `plan.md` Residual Risks for the Orchestrator to
  route through the user; no live host action was taken or attempted this
  unit (all inherited baselines are stale per this session's own
  instruction; a fresh baseline was never taken since no live testing was
  performed). This Lead stint reached its return threshold (three
  independently-accepted Worker slices) and returns `handover` after this
  entry. Committed and pushed by this Lead at `6a70701 test(workspace): add
  unit-05 cross-mode regression coverage` (`cb9b121..6a70701`), confirmed
  via `git push` output, including the
  `docs/changes/trailing-empty-workspace/` process artifacts alongside the
  code.

## 2026-08-20 (unit-05, closing dispatch: forensic reconciliation + reachability-gap closure)

- Role / unit: Lead (executing directly, no subagent dispatched - explicit
  narrow exception authorized for this dispatch after two prior Worker-tier
  dispatches on this unit stalled) / unit-05
- Result (Task 0, forensic reconciliation): found an uncommitted, unrecorded
  working-tree diff in `kwin/tests/controller.test.ts` (139 insertions/3
  deletions), left by a cancelled prior dispatch with no plan.md/log.md
  trace. Inspected the diff directly before any other action: it added two
  tests to the "per-output-local workspaces (Unit 05)" block - a
  3-simultaneous-output occupied scenario and a disconnect-from-three-to-two
  scenario - and corrected the stale test title at the prior offset
  `controller.test.ts:15364` ("Meta+0 always creates..." to "Meta+0 creates
  ... when none exists yet"), a title-and-comment-only change with the
  assertion body itself untouched. Judged the diff on its merits per
  instruction: kept in full. Reasoning - both new tests are pure additions
  (no deletions beyond the one title/comment edit), confined to the declared
  per-output-local scope, contain zero `ownedDesktopIds` references, and
  (confirmed by running the full suite before making any other change) pass
  against the unmodified production controller, meaning their assertions
  accurately describe real behavior rather than encoding a wrong assumption.
  The title fix is exactly the "trivial rename and nothing else" case the
  brief called for. Ran the full baseline suite first to confirm a
  known-good tree before building on it: 834/834 pass (832 committed
  baseline + these 2 orphan tests), typecheck clean on both tsconfigs,
  `main.js` byte-identical to committed `HEAD` (git diff --stat empty),
  confirming the orphan diff introduced no production drift.
- Result (gap closure): read plan.md's Progress/Acceptance-Criterion-
  Evidence/Residual-Risks and this file's latest entry for handover state.
  Per Orchestrator ruling, treated the first Lead's "no locatable code
  branch gating on these conditions" claim as a hypothesis, not settled
  fact, and read the relevant production code directly before writing any
  test: `rebuildGlobalUniqueMapping` (`controller.ts:8983-9021` at this
  dispatch's start) to understand exactly how global-unique folds an
  disconnecting output's desktops into `globalUniquePrimary` (not simply
  dropping them, unlike per-output-local) and how a newly (re)connecting
  output never adopts an existing spare (`enforceGlobalTrailingEmpty`
  always creates fresh, per the existing "newly connected output gets a
  freshly created trailing empty" test's own precedent). Found the shared
  block already contained a genuine output-replug test ("hotplug adds a new
  output at the current shared workspace and never creates a desktop",
  disconnects then reconnects the identical `OUTPUT_L` tuple) that the first
  Lead's gap list had missed - refuted that specific claim by direct
  evidence rather than adding a duplicate test.
  Added four new tests, each hand-written (no subagent), iterated against
  the unmodified controller and corrected until every assertion matched
  real observed behavior (not guessed):
  1. Global-unique 3-simultaneous-output + disconnect-3-to-2 (combined,
     "global-unique workspaces (Unit 06)" block): first attempt's raw
     assertion of `removedDesktops === ["desktop-10"]` failed with an actual
     of `["desktop-10","desktop-2","desktop-4","desktop-5","desktop-6"]` -
     root cause was a test-authoring gap, not a production defect: the
     freshly-seeded fixture had never been settled once before capturing a
     "before" baseline, so the disconnect-triggered dispatch swept the
     fixture's own never-occupied spare desktops in the same pass as N's
     disconnect, conflating two effects. Fixed by adding one
     `harness.emitDesktopsChanged()` settle call right after seeding/before
     capturing the baseline (mirroring the settled-precondition style the
     existing 2-output disconnect test already uses), then correcting the
     expected post-disconnect `keyE` list to `["desktop-1","desktop-7",
     "desktop-9"]`. Re-ran; passed.
  2. Global-unique output replug ("global-unique workspaces (Unit 06)"
     block): passed on first run; needed one typecheck-only fix (an
     `array[0]` read typed as `string | undefined`, asserted as `string`
     with an explicit cast after the adjacent length check already
     guaranteed a value) - not a logic change.
  3. Shared 3-simultaneous-output + disconnect-3-to-2 (combined, "shared
     workspaces (Unit 07)" block): passed on first run.
  4. Rapid disconnect/reconnect flapping interleaved with occupation
     ("per-output-local workspaces (Unit 05)" block, placed there per the
     gap's "anywhere" wording): first attempt's assertion `lAfter.length ===
     2` failed with an actual of `1` - root cause was a missing settle
     (`flushNextYield` loop) after the final reconnect in the flap sequence,
     the same "scope change arms a deferred reconstruction" pattern every
     other disconnect/reconnect test in this file already accounts for; the
     test simply hadn't included it yet on the first draft. Fixed by adding
     the standard settle loop before the final `emitDesktopsChanged()`.
     Re-ran; passed.
  Both corrections were pre-run test-authoring mistakes on tests never
  previously run, not production-code discoveries - `kwin/src/controller.ts`
  was read for design understanding but never edited or diffed against
  this dispatch's own changes.
- Files / commit: `kwin/tests/controller.test.ts` only (orphan diff kept
  as-is, plus 4 new hand-written tests, plus the one typecheck cast fix);
  `kwin/contents/code/main.js` confirmed byte-identical to committed `HEAD`
  throughout (test-only changes, no source edit, `git diff --stat --
  kwin/contents/code/main.js` empty at every checkpoint);
  `docs/changes/trailing-empty-workspace/{plan.md,log.md}` (this entry,
  Progress marked `[x]`, new Acceptance-Criterion Evidence entry, Residual
  Risks closure note reaffirming the live-runtime oscillation residual
  explicitly remains open).
- Verification: full build+esbuild+`node --test` -> 838 tests, 78 suites,
  838 pass, 0 fail (832 baseline + 6 new: 2 orphan-diff + 4 this dispatch).
  `npm --prefix kwin run typecheck` -> clean, both tsconfigs (after the one
  cast fix). `devenv shell --impure -- bash -c "cd scripts && bash
  dogfood-install.test.sh"` -> 336/336, unchanged. `main.js` confirmed
  byte-identical to committed `HEAD` after every build in this dispatch.
- Notes: no real defect found in production code - every new/kept test's
  final, corrected assertions describe behavior the unmodified controller
  already produces; nothing was escalated as a defect per the brief's
  stop-and-report instruction, because nothing qualified. unit-05 marked
  `[x]` (all its declared acceptance criteria now met: the original core
  sweep plus the Orchestrator-ruled-in-scope reachability gaps). The
  live-runtime oscillation residual (proposed three-scenario live-check,
  `docs/live-kwin-testing.md`-gated, not performed this dispatch or any
  prior one) is explicitly and deliberately left open, recorded in Residual
  Risks, and is not resolved by this or any static-only dispatch. No live
  host mutation was performed. Committed and pushed by this Lead at
  `f77e772 test(workspace): close unit-05 3+-output, disconnect, replug, and
  flap coverage gaps` (`6a70701..f77e772`).

## 2026-08-20 (unit-06)

- Role / unit: Lead / unit-06, attempt-01
- Result: Documentation-only unit, performed directly by this Lead per
  explicit brief exception (no Worker dispatch). Verified all four cited
  `docs/roadmap.md` line refs (174, 180, 185, 242) against current `HEAD`
  before editing - unchanged, still pointed at the stale claims. Read
  `docs/roadmap.md` in full (388 lines) rather than trusting the four-line
  list was exhaustive; found and corrected one further stale span (section
  6's "Main KWin risk"/"Status" paragraph, pre-edit ~197-210) asserting
  "auto-removed with no replenish" and "create-on-demand ... implemented and
  live-accepted" as settled fact. Corrected `docs/backlog.md`'s three P2
  entries (pre-edit lines 22-24) asserting the same superseded rule; left
  the ownership-independent-cleanup entry (line 25, unaffected, still
  accurate) and the standing "user's next selected work" entry for this
  change (line 28) untouched, the latter per explicit instruction (belongs
  to the completion transaction, not this unit). Grepped both files after
  editing for `create-on-demand`/`always creat`/`never reuse`/`no reserved`
  - all remaining hits are past-tense framing of the rule being reversed,
  not present-tense fact. Checked (did not edit) the adjacent, out-of-scope
  `docs/backlog.md:27` entry (7 stale doc-comment locations describing "the
  removed ownership/reserved-trailing-empty desktop model") for continued
  accuracy: found it is now itself inaccurate. Direct evidence: `git show
  884ff95:kwin/src/controller.ts` confirms the entry's own cited example
  (the `Meta+0` KDE-settings description string, "Focus or create the
  trailing empty workspace") was identical wording pre-dating this change
  and correctly flagged stale then; that same string is unedited at current
  `HEAD` (`kwin/src/controller.ts:614`) and, because this change
  structurally reinstated a real trailing-empty concept, the string is now
  an accurate description of shipped behavior again - the entry's "removed"
  premise no longer holds. Separately, `grep cleanupEligibleDesktops
  kwin/src/controller.ts` returned zero hits: that function was deleted as
  dead code during unit-04, so the entry's second clause (about it doubling
  API calls) is also now stale. Not fixed, per the brief's "leave it"
  instruction; reported to the Orchestrator via chat and recorded in
  `plan.md` Acceptance-Criterion Evidence for unit-06. Also corrected two
  pieces of stale Lead-owned record-keeping found while working this unit:
  `plan.md`'s header `Status` line (still said "ready to dispatch unit-01")
  and its `Final Outcome` section (still said unit-04 was staged-only and
  units 05-06 remained, though unit-04/05/07 were already committed at
  `4a3c044`/`f77e772`/`cb9b121` per `git log`) - both now reflect the actual
  commit sequence.
- Files / commit: `docs/roadmap.md`, `docs/backlog.md` (staged via `git add`,
  not committed, per commit protocol); `docs/changes/trailing-empty-workspace/
  {plan.md,log.md}` (this entry; Progress marked `[x]` for unit-06; new
  Acceptance-Criterion Evidence entry; `Final Outcome` and header `Status`
  corrected) - process artifacts, left untracked as in every prior unit of
  this change.
- Verification: full build+esbuild+`node --test` -> 838 tests, 78 suites,
  838 pass, 0 fail (unchanged from unit-05's closing baseline; no source
  touched). `npm --prefix kwin run typecheck` -> clean, both tsconfigs.
  `git diff --stat -- kwin/contents/code/main.js` empty - byte-identical to
  committed `HEAD`. `git status --porcelain` confirms only `docs/roadmap.md`
  and `docs/backlog.md` modified (plus the three permanently-excluded
  untracked paths, untouched).
- Notes: no governance conflict; no `docs/decisions.md` edit. unit-06 marked
  `[x]` - this closes the last open work unit of the plan (`Progress`: all of
  01, 02, 03, 03b, 04, 05, 06, 07 now `[x]`). The change is not yet through
  its completion transaction (acceptance-evidence map/residual-risk summary
  review, Orchestrator alignment approval, user result approval, then
  promote/archive/backlog-removal) - that is a separate Lead-owned step this
  unit does not perform. Proposed conventional-commit subject for the
  user: `docs(trailing-empty-workspace): correct roadmap and backlog for
  the trailing-empty-reuse model`.
