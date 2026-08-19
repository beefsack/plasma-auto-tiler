# Plan: Trailing Empty Workspace (COSMIC-style reuse)

Ownership and approval:
- Owner: Lead
- Status: Approved; spec.md rulings encoded; ready to dispatch unit-01

Semantic sections - Technical Approach, Work Units, Pending User Decisions -
need Orchestrator approval before each edit. Record-keeping sections -
Progress, Attempt Accounting, Acceptance-Criterion Evidence, Residual Risks,
Final Outcome - are Lead-owned and edited directly.

## Technical Approach

**Structural, not identity-based, invariant.** The trailing empty is
identified fresh on every `cleanupDesktops()` pass as "the last-positioned
desktop in the relevant domain order that is currently empty" - never cached
in a Set across dispatches (that was the original ownership-gating defect
class; do not repeat it for the trailing-empty concept either).

**One shared invariant helper.** The prior implementation (pre-Q6, commit
`538ad7f`) triplicated the reserved-capacity trim+replenish pattern once per
mode, which succession-3 of the prior change identified as the reason the
`position === lastIndex` removal guard was hard to reason about and easy to
break. This change instead introduces one shared "ensure exactly one trailing
empty" helper, parameterized by the caller's domain-ordered desktop-id list
and its create/remove primitives, called once per relevant domain
(per-output-local: once per output; global-unique/shared: once for the
global list) from within each mode's existing `cleanupDesktops()`/reconcile
path. This concentrates the anti-oscillation logic in one place instead of
three, directly reducing the main technical risk.

**Anti-oscillation design (the core risk).** Within one `cleanupDesktops()`
dispatch, for each domain:

1. Recompute eligibility fresh (unchanged existing rule: empty AND invisible
   on every connected output), but exclude the current structurally-identified
   trailing-empty desktop from the eligible set.
2. Remove whatever remains eligible (identical to today's behavior - this
   change adds no new removal cases).
3. Re-read the domain's desktop list *after* removal (not the pre-removal
   snapshot) and check the invariant: does an empty desktop exist at the
   trailing position? If yes, done - no-op. If no (the last desktop is
   occupied, or the domain is empty of desktops entirely, which should not
   happen given the last-global-desktop floor), append exactly one new empty
   desktop and stop - do not loop.
4. `Meta+0`/`Meta+Shift+0` handlers query the same structural
   "current trailing empty, if any" read; reuse it if present and (for
   `Meta+0`) not already the current desktop; otherwise fall back to the same
   append primitive used by step 3, so there is exactly one append code path
   per domain, not two.

Because every step recomputes from current state and step 3 only appends when
the post-removal invariant is actually violated, a dispatch that changes
nothing produces zero creates/removes, and a dispatch that both removes a
stale invisible empty and needs to preserve the trailing invariant does both
in one pass without a second dispatch or timer. No debounce/timer mechanism
is introduced (per spec constraint).

**Mode domains**, per the current code survey, as revised 2026-08-19 (see
spec.md Q-Domain):
- `per-output-local`: one domain per connected output (its own ordered local
  desktop-id list).
- `global-unique`: one domain per connected output, structurally identified
  within that output's own `globalUniqueAssigned` assignment group (ordered
  by `x11DesktopNumber`, via the existing `globalUniqueOrdered` helper), not
  the single global list. `unit-03`'s original single-global-domain wiring is
  superseded; reworked by `unit-03b`.
- `shared`: one domain (the single shared desktop list). Unaffected by the
  Q-Domain revision.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification (static or live) |
|---|---|---|---|---|
| unit-01 | Shared "ensure exactly one trailing empty" invariant helper: structural trailing-empty identification, protect-from-cleanup exclusion, post-removal append-if-needed step, with its own idempotency/stability unit tests (no mode wiring yet) | - | `kwin/src/controller.ts` (new helper, not yet called); `kwin/tests/controller.test.ts` (new isolated helper tests) | static: `node --test` on new helper tests only |
| unit-02 | Wire `per-output-local` mode: cleanup path calls the helper per output; `Meta+0`/`Meta+Shift+0`/`finishWorkspaceZero`/`finishMoveToTrailing` local branches reuse-if-present; rewrite the affected "Unit 05" describe-block assertions | unit-01 | `kwin/src/controller.ts` (`reconcileLocalWorkspaces`, `removeOwnedEmptyDesktop`, `finishWorkspaceZero` local branch, `appendTrailingForOutput` call sites); `kwin/tests/controller.test.ts` ("per-output-local workspaces (Unit 05)" block, lines ~14604-15046) | static: full `node --test`; targeted stability test added |
| unit-03 | Wire `global-unique` mode: same shape as unit-02 for the global-unique domain and its describe block | unit-01 | `kwin/src/controller.ts` (`reconcileGlobalUnique`, `removeOwnedEmptyGlobalUnique`, global-unique `Meta+0`/`Meta+Shift+0` branches); `kwin/tests/controller.test.ts` ("global-unique workspaces (Unit 06)" block, lines ~15046-15444) | static: full `node --test`; targeted stability test added |
| unit-03b | Rework `global-unique` mode to the revised Q-Domain ruling (2026-08-19): `enforceGlobalTrailingEmpty`/`resolveGlobalTrailingEmpty` become per-connected-output enforcement scoped to each output's own `globalUniqueAssigned` group (mirroring `enforceLocalTrailingEmpties`/`resolveLocalTrailingEmpty`), using the existing `globalUniqueOrdered` helper for domain order; the three reuse call sites (`finishGlobalWorkspaceZero`, `finishMoveToTrailing`, `moveActiveToWorkspace` index-0 branch) stop calling `globalUniqueSwapIfVisibleElsewhere` on the trailing-empty path only (helper stays in use for ordinary `Meta+1..9` navigation/move-follow); disconnect makes the disconnected output's former trailing immediately eligible for removal, not adopted; connect always creates a fresh trailing, never adopts a spare. Supersedes `unit-03`'s wiring; does not rewrite `unit-03`'s own historical record. | unit-01, supersedes unit-03's wiring | `kwin/src/controller.ts` (`enforceGlobalTrailingEmpty`, `resolveGlobalTrailingEmpty`, `finishGlobalWorkspaceZero`, `finishMoveToTrailing` global-unique branch, `moveActiveToWorkspace` index-0 branch, new key-based append helper mirroring `appendDesktopForOutputKey`); `kwin/tests/controller.test.ts` ("global-unique workspaces (Unit 06)" describe block, lines ~15285-15741) | static: full `node --test`; new disconnect/connect regression tests; typecheck both tsconfigs |
| unit-04 | Wire `shared` mode: same shape as unit-02/03 for the shared domain and its describe block | unit-01 | `kwin/src/controller.ts` (inline shared reconcile fragment in `cleanupDesktops`, `removeOwnedEmptyShared`, `finishSharedWorkspaceZero`); `kwin/tests/controller.test.ts` ("shared workspaces (Unit 07)" block, lines ~15444-end) | static: full `node --test`; targeted stability test added |
| unit-05 | Cross-mode regression sweep: rewrite/remove the remaining ~34 "always create, never reuse, no reserved capacity" assertions in the "dynamic virtual desktops" and "workspace mode and per-output seams (Unit 04)" blocks that are not mode-specific; add the multi-output (Q-MultiOutput) and event-ordering oscillation coverage from the spec | unit-02, unit-03, unit-04 | `kwin/tests/controller.test.ts` ("TileController dynamic virtual desktops" and "workspace mode and per-output seams (Unit 04)" blocks) | static: full `node --test`, exact pass count reported and reconciled against the pre-change 802 baseline |
| unit-06 | Documentation correction: `docs/roadmap.md` lines 174/180/185/242 and the relevant `docs/backlog.md` entry updated to describe the trailing-empty-reuse model | unit-05 | `docs/roadmap.md`, `docs/backlog.md` | static: proofread diff only, run as part of the completion transaction, not before user acceptance of delivered behavior |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

Effort estimate: units 01-04 are the substantive risk-bearing work (unit-01
carries the anti-oscillation design risk most directly and is the most likely
to need a correction round or a second independent review given the
oscillation history; units 02-04 are expected to be comparatively mechanical
once unit-01 is accepted, one Worker slice each). Units 05-06 are small.
Overall shape and size is comparable to, but smaller in scope than, the prior
`workspace-management-fixes` change (which needed a Lead succession); no
Expanded-process trigger is currently anticipated, but unit-01's oscillation
risk is exactly the kind of thing that could surface one if the first attempt
does not converge cleanly.

## Progress

- [x] unit-01 Shared trailing-empty invariant helper (accepted, attempt-01)
- [x] unit-02 Wire per-output-local mode (accepted, attempt-02, one
      same-scope correction round: fixed 5 failing tests - 4 stale
      pre-reuse-model assertions, 1 genuine orphan-sweep gap; correction
      round fixed an ownership-gating regression the Lead found by direct
      diff inspection in the orphan sweep and added one new regression
      test; 809/809 pass, typecheck clean)
- [x] unit-03 Wire global-unique mode (accepted, attempt-01, no correction
      round; 811/811 pass, typecheck clean; wiring now flagged superseded by
      the revised Q-Domain ruling - see unit-03b)
- [x] unit-03b Rework global-unique mode to the revised Q-Domain ruling
      (accepted, attempt-01, no correction round; 813/813 pass, typecheck
      clean; committed by the user at `7c28759`)
- [x] unit-04 Wire shared mode (accepted, attempt-01, no correction round;
      815/815 pass, typecheck clean; attempt-01's dispatching Lead was
      cancelled mid-flight before returning any report - independently
      reconciled and re-verified by a successor Lead, see Attempt Accounting)
- [ ] unit-05 Cross-mode regression sweep
- [ ] unit-06 Documentation correction

## Attempt Accounting

- unit-02, attempt-01: cancelled mid-flight (340k-token Worker, quota
  exhausted, no report). Ground-truth reconciliation (see log.md) found the
  work coherent and scoped correctly but incomplete: 5 failing tests, all
  within unit-02's own describe block.
- unit-02, attempt-02: accepted. Per Orchestrator's dispatch brief, the
  cancelled attempt-01 work counted as a full attempt despite never
  reaching review-ready. Lead independently re-verified the 808/803/5
  baseline before dispatching (see log.md). One same-scope correction
  round was used within attempt-02 (rejected a `review-ready` report that
  reintroduced ownership gating in a new orphan-sweep; one correction
  fixed it) - this does not itself count as a third attempt. unit-02 is
  now closed at attempt-02 with one correction round; no further dispatch
  on this unit is expected, so the breaker is moot for it unless a defect
  surfaces later.
- unit-04, attempt-01: dispatched by a prior Lead succession, which wrote a
  full `review-ready`-shaped log.md/plan.md record (diff inspection claims,
  815/815 verification claims) but was cancelled by quota exhaustion before
  returning any report to the Orchestrator or this Lead, leaving the record
  unconfirmed. This reconciliation stint treated all of it as unverified and
  independently re-established every claim from scratch, without dispatching
  a new Worker or changing any code: (1) read the staged `git diff --cached`
  for both `controller.ts` (249 diff lines) and `controller.test.ts` (279
  diff lines) directly and confirmed every hunk falls within shared-mode
  scope only (`controller.ts` old-line ranges 40, 7752-8460;
  `controller.test.ts` three named locations in "dynamic virtual desktops"
  12467-12643 plus the full "shared workspaces (Unit 07)" block
  15928-16222), confirmed zero `ownedDesktopIds` references in either diff,
  confirmed `ensureTrailingEmptyDesktop` (unit-01, `controller.ts:~1651`) and
  all `per-output-local`/`global-unique` methods are untouched, and confirmed
  `enforceSharedTrailingEmpty`/`resolveSharedTrailingEmpty` operate on the
  single entire live desktop list with no per-output loop (i.e. did not
  import unit-02/03b's per-output design into shared mode); (2) independently
  ran `npm --prefix kwin run typecheck` (clean, both tsconfigs) and the full
  build+esbuild+`node --test` suite (815 tests, 77 suites, 815 pass, 0 fail -
  exact match to the unverified record's claim, +2 over the 813 baseline at
  HEAD `7c28759`, accounted for by the new Q-Zero no-op test and the new
  idempotency test); (3) independently reran `npm run build` a second time
  and confirmed `main.js` produces zero further diff (deterministic, not
  hand-edited). Accepted as attempt-01 (no second Worker dispatch or code
  change was needed; the reconciliation confirmed the artifacts were already
  correct). No Attempt Accounting entry would normally be needed for a
  first-try acceptance, but this entry is recorded per explicit instruction
  given the cancellation.

## Pending User Decisions

None outstanding. User ruled on all three original surfaced ambiguities
(2026-08-19), matching the Lead's recommendation in each case, and later
issued a revised Q-Domain ruling for `global-unique` (2026-08-19, approved by
the Orchestrator), answering inv-01's five open questions. All encoded in
`spec.md` Resolved Questions:
- Q-Domain (as revised): one trailing empty per output in `per-output-local`
  (unchanged) and `global-unique` (revised - scoped to each output's own
  `globalUniqueAssigned` group, no cross-output swap-adoption on the
  trailing-empty path, disconnect not adopted, connect always fresh); one
  global trailing empty in `shared` (unchanged, retained deliberately).
- Q-Zero: `Meta+0` is a no-op when already on the trailing empty.
- Q-Manual: non-trailing manual empties remain cleanup-eligible when
  invisible.

Q-Pager accepted as-is (not contentious). Q-MultiOutput is a test-coverage
requirement carried into unit-05, not a product decision. Q-Diagnostic-ID
resolved as a stale brief - the Orchestrator's prior-change addition already
covers it; nothing folded into scope. `shared` mode's open question (inv-01
question 1) is resolved: the revised ruling does not reach `shared`; its
prior one-global-trailing-empty behavior is retained deliberately, `unit-04`
scope is unaffected.

## Acceptance-Criterion Evidence

- "No in-memory ownership/identity Set introduced": met by `ensureTrailingEmptyDesktop`,
  `kwin/src/controller.ts:1651-1719` - purely functional, no module-level or
  closure state; trailing empty identified fresh from `orderedIds` each call.
- "Repeated `cleanupDesktops()` dispatches idempotent" (helper-level slice):
  met by `kwin/tests/controller.test.ts:8419-8528` "is idempotent" case -
  Lead independently reran `node --test`, 808/808 pass. Mode-level wiring
  (per-mode dispatch idempotency) still pending units 02-04.
  Full command: `devenv shell --impure -- bash -c "cd kwin && npm run
  build && rm -rf dist/tests && esbuild 'tests/*.test.ts' --bundle
  --platform=node --format=cjs --target=es2020 --outdir=dist/tests &&
  node --test 'dist/tests/**/*.test.js'"`.
- "802 pre-existing tests unchanged": met - 802 baseline + 6 new
  `ensureTrailingEmptyDesktop` tests = 808/808, zero regressions,
  independently reproduced by the Lead.
- Per-output-local domain acceptance (unit-02, now met): "exactly one
  trailing empty per output, never zero/never more from this mechanism" and
  "trailing empty never removed while empty" - met by
  `enforceLocalTrailingEmpties` (`controller.ts:8419-8479`) calling
  `ensureTrailingEmptyDesktop` once per connected output domain. "Other
  empty invisible desktops remain removable, ownership-independent,
  including on output disconnect" - met by the corrected orphan sweep
  (`controller.ts:8446-8474`), which iterates the full live desktop list,
  not `ownedDesktopIds`; regression-tested at
  `controller.test.ts:15079-15116`. "Meta+0/Meta+Shift+0 reuse existing
  trailing empty, no-op / create-only-if-absent" - met by
  `resolveLocalTrailingEmpty`/`isCurrentOnOutput`
  (`controller.ts:8481-8511`) and their use in `finishWorkspaceZero`/
  `finishLocalWorkspaceZero`/`finishMoveToTrailing`. "No ownership Set
  introduced or reintroduced" - met; the Lead's own diff inspection found
  and required removal of the one place it had crept back in. "Repeated
  cleanupDesktops idempotent" (per-output-local) and "802 pre-existing
  tests unchanged or deliberately updated" - met: 809/809 pass (808 prior +
  1 new orphan-sweep regression test), 0 fail, independently reproduced by
  the Lead via the standard build+esbuild+`node --test` command.
- Global-unique domain acceptance (unit-03, now met): "exactly one trailing
  empty in the global domain, never zero/never more from this mechanism" and
  "trailing empty never removed while empty" - met by
  `enforceGlobalTrailingEmpty` (`controller.ts` beside
  `removeOwnedEmptyGlobalUnique`) calling `ensureTrailingEmptyDesktop` once
  for the single global domain (entire live desktop list ordered by
  `x11DesktopNumber`, per Q-Domain). "Other empty invisible desktops remain
  removable, ownership-independent" - met; no orphan sweep was needed
  (domain is the whole live list, so nothing can fall outside it), and no
  `ownedDesktopIds` reference exists anywhere in the diff (Lead-verified via
  direct diff grep). "Meta+0/Meta+Shift+0 reuse existing trailing empty,
  no-op / create-only-if-absent" - met by `resolveGlobalTrailingEmpty` and
  its use in `finishGlobalWorkspaceZero`/`finishMoveToTrailing`/
  `moveActiveToWorkspace`'s index-0 branch, including the cross-output swap
  interaction (via the pre-existing, reused `globalUniqueSwapIfVisibleElsewhere`)
  when the reused trailing empty is currently shown on a different output -
  regression-tested at `controller.test.ts:15717-15738`. "No ownership Set
  introduced or reintroduced" - met, Lead-verified by direct diff inspection.
  "Repeated cleanupDesktops idempotent" (global-unique) - met, regression-
  tested at `controller.test.ts:15699-15715`. "802 pre-existing tests
  unchanged or deliberately updated" - met: 811/811 pass (809 prior + 2 new
  unit-03 tests), 0 fail, independently reproduced by the Lead.
- Global-unique domain acceptance, as revised (unit-03b, now met): "one
  trailing empty per connected output, structurally identified within that
  output's own domain, never zero/never more from this mechanism" - met by
  the rewritten `enforceGlobalTrailingEmpty`/`resolveGlobalTrailingEmpty`
  (`controller.ts`, per-output loop over `connectedOutputKeys()` using
  `globalUniqueOrdered(desktops, key)` as each domain), mirroring
  `enforceLocalTrailingEmpties`/`resolveLocalTrailingEmpty`'s shape exactly.
  "Meta+0/Meta+Shift+0/`moveActiveToWorkspace(0)` scoped to the active
  output's own trailing empty only, never cross-output swap-adoption" - met;
  all three reuse call sites no longer call
  `globalUniqueSwapIfVisibleElsewhere` on the trailing-empty path (confirmed
  by Lead's own diff read: the call is removed at all three sites and the
  helper's only remaining call sites are the unchanged `index > 0`
  navigation/move-follow branches); regression-tested by "Meta+0 never
  applies the cross-output swap on the trailing-empty reuse path..."
  (`controller.test.ts`, global-unique Unit 06 block) asserting zero
  `workspace-navigate-swap` events and no cross-output current-desktop
  write. "Output disconnect: former trailing immediately eligible for
  removal, not adopted" - met and regression-tested by the rewritten
  disconnect test (former E-trailing `desktop-7`, empty, folded by the
  unchanged `rebuildGlobalUniqueMapping` into L's group, is removed in the
  same pass because L's own `desktop-8` remains structurally last, not
  `desktop-7`). "Output connect: always a freshly created trailing, never an
  adopted spare" - met and regression-tested by the new "a newly connected
  output gets a freshly created trailing empty, never an adopted spare
  desktop" test (asserts exactly one new `createDesktop` call, no reuse of
  any pre-existing spare). "No ownership Set introduced or reintroduced" -
  met; Lead independently grepped the full diff for `ownedDesktopIds` in
  both `controller.ts` and `controller.test.ts` and found zero hits beyond
  the pre-existing, unchanged `ownedDesktopIdSnapshot()` test accessor. "No
  orphan sweep needed" - the Worker independently verified (not assumed)
  that `rebuildGlobalUniqueMapping` unconditionally folds every unassigned
  live desktop into the primary output's group whenever at least one output
  is connected, so no desktop ever falls outside all domains; no orphan-sweep
  code was added, matching per-output-local's precedent of only adding one
  where the mapping-rebuild genuinely drops ids entirely. "Repeated
  `cleanupDesktops()` idempotent" and "813 tests pass" (811 prior + 2 net:
  -1 removed cross-output-swap-adoption test, +3 added: no-swap-on-trailing,
  multi-output-per-output-trailing, connect-fresh-not-adopted) - met: 813/813
  pass, 0 fail, independently reproduced by the Lead via the standard
  build+esbuild+`node --test` command; typecheck clean on both tsconfigs,
  independently reproduced; `main.js` independently confirmed a
  deterministic, faithful regeneration (identical diff before and after a
  second fresh `npm run build`). `per-output-local` and `shared` code and
  tests confirmed untouched by direct diff inspection (all hunks fall within
  the declared global-unique scope: `controller.ts` lines
  7694-8033/8907-9057 old-line ranges; `controller.test.ts` entirely within
  the "global-unique workspaces (Unit 06)" describe block, 15285-15778).
  `unit-03`'s own acceptance evidence above is left as an accurate
  historical record of work done against the ruling in force at the time;
  this entry supersedes it for current behavior.
- Shared domain acceptance (unit-04, now met): "one global trailing empty in
  the shared domain, never zero/never more from this mechanism" and "trailing
  empty never removed while empty" - met by `enforceSharedTrailingEmpty`
  (`controller.ts`, replacing the deleted `cleanupEligibleDesktops()`) calling
  `ensureTrailingEmptyDesktop` once for the single global domain (the entire
  live desktop list, per Q-Domain - `synchronizeShared` unchanged, no
  per-output split introduced). "Other empty invisible desktops remain
  removable, ownership-independent" - met; no orphan sweep needed (the shared
  domain is definitionally the whole live list, so no desktop can fall
  outside it), reusing the pre-existing, unchanged `removeOwnedEmptyShared`.
  "Meta+0/Meta+Shift+0 reuse existing trailing empty, no-op when already
  current / create-only-if-absent" - met by `resolveSharedTrailingEmpty`/
  `isCurrentShared` and their use in `finishSharedWorkspaceZero`,
  `finishMoveToTrailing`'s shared branch, and `moveActiveToWorkspace`'s
  index-0 shared branch; regression-tested by a new explicit Q-Zero no-op
  test in the "shared workspaces (Unit 07)" block. "Appends exactly one new
  trailing empty when the current one becomes occupied" - regression-tested
  by the rewritten Meta+Shift+0/Meta+0 reuse tests, each asserting the
  replenish create alongside the reuse. "No ownership Set introduced or
  reintroduced" - met; Lead independently ran `git diff ... | grep
  ownedDesktopIds` against both `controller.ts` and `controller.test.ts` and
  found zero hits. "Repeated `cleanupDesktops()` idempotent" (shared) - met,
  regression-tested by a new explicit idempotency test in the same block.
  Mechanically required consequence of the wiring, verified in scope: the now
  fully-dead `cleanupEligibleDesktops()` private method and the
  `planDesktopCleanup` import were removed from `controller.ts` (the function
  itself, its types, and its own direct unit tests in `logic.ts`/
  `tests/logic.test.ts` are untouched) - `noUnusedLocals` would otherwise fail
  typecheck. Three shared-only tests in the "TileController dynamic virtual
  desktops" block that directly asserted the old "no reserved trailing
  capacity" premise (outside the Unit 07 block, but exclusively about shared
  mode's own cleanup floor, so in this unit's own scope, not unit-05's) were
  corrected to assert the new trailing-protection behavior. "815/815 pass"
  (813 prior + 2 net: Q-Zero no-op test, idempotency test) and typecheck
  clean on both tsconfigs - met, independently reproduced by the Lead via the
  standard build+esbuild+`node --test` command; `main.js` independently
  confirmed a deterministic, faithful regeneration (no further diff after a
  second fresh `npm run build`). `per-output-local` and `global-unique` code
  and tests confirmed untouched by direct diff inspection (all `controller.ts`
  hunks fall within the declared shared-mode scope, old-line ranges
  7752-8448; all `controller.test.ts` hunks fall within the "TileController
  dynamic virtual desktops" block, three named locations only, and the
  "shared workspaces (Unit 07)" block, 15778-end - none touch the Unit 04/05/
  06 test blocks).
- Remaining acceptance criteria (cross-mode sweep, docs correction) are
  unit-05 and unit-06 and remain unmet pending those units.

## Residual Risks

- Oscillation risk under Q7's broadened dispatch triggers is the primary
  technical risk of this change; unit-01's stability tests are the main
  mitigation and should be reviewed closely before unit-02 begins.
- The shared-helper approach (one implementation instead of three) is a
  deliberate deviation from strictly mirroring the pre-Q6 per-mode
  duplication; if review finds mode-specific semantics do not fit a single
  helper cleanly, unit-01 may need to split before unit-02 starts.
- (2026-08-19, inv-01) The user issued a new ruling on Meta+0/Meta+Shift+0
  scope that contradicted the Q-Domain ruling `unit-03` was built to. Landed
  `unit-03` (`e2105c2`, committed) was flagged superseded; the ruling was
  approved and the rework landed as `unit-03b` (accepted, staged, not yet
  committed). `unit-03`'s semantic record above is left unchanged (it is an
  accurate historical record of work done against the ruling that was in
  force at the time); `unit-03b` is a new unit, not a rewrite of `unit-03`'s
  history. This risk is now resolved for `global-unique`; `unit-03`'s own
  commit (`e2105c2`) already landed the superseded wiring, so the repository
  history retains both the original and the corrected behavior across two
  commits, which is expected and not a defect.

## Final Outcome

- Pending - unit-01, unit-02 (committed, `1b34a37`), unit-03 (committed,
  `e2105c2`), and unit-03b (committed, `7c28759`) done; unit-04 (accepted,
  staged, not yet committed) done; units 05-06 remain. Not yet the change's
  overall completion transaction.

## Staging Note (2026-08-19, unit-02)

- unit-01 + unit-02 were committed by the user at `1b34a37 feat(workspace):
  reuse trailing empty workspace in per-output-local mode`, confirmed as
  this Lead succession's verified starting `HEAD`.

## Staging Note (2026-08-19, unit-03)

- Staged (`git add`, not committed): `kwin/src/controller.ts`,
  `kwin/tests/controller.test.ts`, `kwin/contents/code/main.js` - the
  unit-03 diff vs. `1b34a37` (+159/-24 in `controller.ts`, +189/-93 in
  `controller.test.ts`, faithful regenerated bundle in `main.js`), verified
  811/811 tests pass and typecheck clean. Proposed conventional-commit
  subject (subject only): `feat(workspace): reuse trailing empty workspace
  in global-unique mode`. `docs/changes/trailing-empty-workspace/` left
  untracked (process artifacts, still being edited across remaining units).
  No commit or push performed - user-only per commit protocol.
- `unit-03` was subsequently committed by the user at `e2105c2 feat(workspace):
  reuse trailing empty workspace in global-unique mode`, confirmed as this
  Lead succession's verified starting `HEAD`.

## Staging Note (2026-08-19, unit-03b)

- Staged (`git add`, not committed): `kwin/src/controller.ts`,
  `kwin/tests/controller.test.ts`, `kwin/contents/code/main.js` - the
  unit-03b diff vs. `e2105c2` (+135/-135 net in `controller.ts` across 8
  hunks, all within the declared global-unique scope; +129 net in
  `controller.test.ts`, entirely within the "global-unique workspaces (Unit
  06)" describe block; faithful regenerated bundle in `main.js`, confirmed
  deterministic by a second fresh `npm run build` producing an identical
  diff), verified 813/813 tests pass (811 prior + net 2: one superseded test
  removed, three added) and typecheck clean on both tsconfigs. Also staged:
  `docs/changes/trailing-empty-workspace/{spec.md,plan.md,log.md}` (this
  Lead's spec amendment and record-keeping, folding in inv-01's
  previously-staged `log.md`/`plan.md` edits so the user makes one commit,
  not two). Proposed conventional-commit subject (subject only):
  `feat(workspace): scope global-unique trailing empty to each output`. No
  commit or push performed - user-only per commit protocol.
- `unit-03b` was subsequently committed by the user at `7c28759
  feat(workspace): scope global-unique trailing empty to each output`,
  confirmed as this Lead succession's verified starting `HEAD`.

## Staging Note (2026-08-19, unit-04)

- Staged (`git add`, not committed): `kwin/src/controller.ts`,
  `kwin/tests/controller.test.ts`, `kwin/contents/code/main.js` - the
  unit-04 diff vs. `7c28759` (`controller.ts` +181/-136 net across 7 hunks,
  old-line ranges 40 and 7752-8448, entirely within the declared shared-mode
  scope: `finishSharedWorkspaceZero`, the shared branches of
  `finishMoveToTrailing` and `moveActiveToWorkspace`'s index-0 case, the
  shared branch of `cleanupDesktops`, and the new
  `enforceSharedTrailingEmpty`/`resolveSharedTrailingEmpty`/`isCurrentShared`/
  `appendDesktopForShared` methods replacing the deleted
  `cleanupEligibleDesktops` and the now-unused `planDesktopCleanup` import;
  `controller.test.ts` +159/-124 net across 12 hunks, three named locations
  in the "TileController dynamic virtual desktops" block plus the full
  "TileController shared workspaces (Unit 07)" block, 15778-end; faithful
  regenerated bundle in `main.js`, confirmed deterministic by the Lead's own
  second fresh `npm run build` producing no further diff), verified 815/815
  tests pass (813 prior + net 2: Q-Zero no-op test, idempotency test) and
  typecheck clean on both tsconfigs, independently reproduced by the Lead.
  `per-output-local` and `global-unique` code and tests confirmed untouched
  by direct diff inspection; `ensureTrailingEmptyDesktop` (unit-01)
  confirmed unmodified. Proposed conventional-commit subject (subject only):
  `feat(workspace): reuse trailing empty workspace in shared mode`. No
  commit or push performed - user-only per commit protocol.
- (2026-08-19, reconciliation) The dispatching Lead was cancelled mid-flight
  by quota exhaustion before returning any report; the record above (written
  before cancellation) was therefore treated as unverified pending
  independent confirmation. A successor Lead reconciled it - see unit-04,
  attempt-01 in Attempt Accounting - and independently confirmed every claim
  (diff scope, no ownership-gating creep, no per-output contamination of
  shared mode, 815/815 tests, clean typecheck, deterministic `main.js`)
  without dispatching a new Worker or changing any code. The staged file set
  and proposed commit subject above are unchanged and confirmed still
  accurate.

## inv-01 Findings and Proposed Revision (APPROVED 2026-08-19 - Orchestrator
and user approved the Q-Domain amendment; encoded in `spec.md` and the
Work Units table above as `unit-03b`. Retained below as the historical
investigation record.)

Investigation-only unit responding to a new user ruling that contradicts the
settled Q-Domain ruling `unit-03` was built to. No production code touched.
Full findings returned to the Orchestrator via chat (2026-08-19). Summary
retained here for continuity:

- `global-unique` mode: the new ruling ("trailing empty on each output;
  Meta+0/Meta+Shift+0 scoped to the active output only") is structurally
  expressible. The mode already partitions the global desktop pool into a
  per-output assignment (`globalUniqueAssigned`, `controller.ts:8936-8974`)
  and tracks a genuinely independent native per-output current desktop
  (`currentDesktopForOutput`/`setCurrentDesktopForScreen`,
  `controller.ts:889,920`). Landed `unit-03` was built to the old "one
  global trailing empty" ruling instead: `enforceGlobalTrailingEmpty`
  (`controller.ts:8986-`) treats the whole live list as one domain, and all
  three reuse call sites apply `globalUniqueSwapIfVisibleElsewhere`
  (`controller.ts:8835-`) to *steal* the single global trailing empty from
  whatever output it is currently shown on - exactly the cross-output
  interaction the new ruling forbids. This needs a rework, proposed as
  **`unit-03b`** (new semantic ID, does not reuse or rewrite `unit-03`):
  - `enforceGlobalTrailingEmpty` -> per-output-domain enforcement, one call
    per connected output's `globalUniqueAssigned` group, mirroring
    `enforceLocalTrailingEmpties` (`controller.ts:8321-`) rather than the
    single-global-domain shape.
  - `resolveGlobalTrailingEmpty` -> resolves within the active output's own
    assignment group only.
  - The three reuse call sites (`finishGlobalWorkspaceZero`,
    `finishMoveToTrailing` global-unique branch, `moveActiveToWorkspace`
    index-0 branch) drop the `globalUniqueSwapIfVisibleElsewhere` call for
    the trailing-empty-reuse path specifically. The helper itself is
    untouched and stays in use for general (non-zero-index) navigation,
    which this ruling does not reach.
  - Worker brief must require the Worker to determine (not assume) whether
    an orphan-sweep equivalent to unit-02's (`controller.ts:8487-8516`) is
    now needed, since global-unique's domain is no longer "the whole live
    list" once split per output.
  - Depends on: `unit-01` (reusable as-is), Orchestrator/user approval of
    the Q-Domain amendment below.
- `shared` mode: the new ruling is **not structurally expressible as
  stated**. `synchronizeShared` (`controller.ts:7581-7613`) writes the same
  target desktop to every connected output on every navigation - "one
  logical workspace set synchronized across every connected output... no
  output owns a desktop" (`controller.ts:7530-7537`). There is no per-output
  desktop domain to hang "a trailing empty on each output" on, and no
  per-output-scoped navigation for Meta+0/Meta+Shift+0 to restrict to -
  every output already always shows the same desktop. Applying the ruling
  literally would require redefining what "shared" mode means (breaking its
  defining synchronized-navigation guarantee), which is a product decision,
  not an implementation detail - escalated as an open question below, not
  resolved here. `unit-04` scope cannot be finalized until this is answered.
- `per-output-local` mode: **unaffected**. It already matches the new ruling
  exactly - `resolveLocalTrailingEmpty(output)` (`controller.ts:8529-`) and
  `isCurrentOnOutput` already scope resolution and reuse to one output's own
  domain, with no cross-output interaction. No rework needed.
- Invariant check (spec.md Constraints / the seven listed invariants): no
  direct conflict found. Two notes, not conflicts: (1) "last-index-only"
  trailing identification is unaffected in *meaning*, only in which ordered
  list it applies to per domain (per-output-local: local list;
  global-unique proposed: the output's `globalUniqueAssigned` sublist,
  ordered the same way the existing navigation code already orders it via
  `globalUniqueOrdered`; shared: unresolved, see above). (2) `unit-03b`'s
  per-output domain enforcement must keep the *global* last-remaining-desktop
  floor as a whole-session check, not a per-output one, in addition to (not
  instead of) each domain's own never-zero trailing invariant - flagged for
  the `unit-03b` Worker brief and unit-05 regression coverage, not a design
  conflict.

### Draft Q-Domain spec amendment (historical draft; superseded by the
approved wording actually applied to `spec.md` Resolved Questions)

> **Q-Domain (REVISED 2026-08-19, supersedes the prior ruling above pending
> approval)**: `per-output-local` - one trailing empty per connected output
> (unchanged). `global-unique` - one trailing empty per connected output,
> structurally identified within that output's existing per-output desktop
> assignment group, not the single global list; `Meta+0`/`Meta+Shift+0`
> interact only with the currently active/focused output's own trailing
> empty and must not reuse-and-swap a trailing empty currently displayed on
> a different output (the behavior the now-superseded `unit-03` wiring
> implemented). `shared` - UNRESOLVED. `shared` mode's `synchronizeShared`
> mechanism forces every connected output onto the same current desktop
> simultaneously; there is no per-output desktop domain to hang "one
> trailing empty per output" on, and no per-output-scoped navigation exists
> for Meta+0/Meta+Shift+0 to restrict to. The new ruling appears
> structurally inexpressible for this mode as stated. Awaiting user
> clarification before `unit-04` scope is finalized.

### Open questions for the user (RESOLVED 2026-08-19 - see the revised
Q-Domain ruling in `spec.md` and Pending User Decisions above; retained below
as the historical record of what was asked)

1. Does the new ruling apply to `shared` mode at all? `synchronizeShared`
   forces every connected output onto one synchronized current desktop by
   design; honoring the ruling literally there would mean redefining what
   "shared" mode is (it would stop keeping every output on one desktop).
   The ruling was given in answer to a narrower `global-unique` question -
   is `shared` intended to keep its original (old-ruling, one global
   trailing empty) behavior, or does "shared" mode's definition itself need
   to change?
2. For `global-unique`, should `globalUniqueSwapIfVisibleElsewhere`'s
   "steal from another output" mechanic still ever fire as part of
   Meta+0/Meta+Shift+0's trailing-empty resolution, or is that exact
   behavior what the new ruling means to forbid? (Lead's reading: forbid it
   for the trailing-empty path specifically; general non-zero-index
   navigation swap is a separate, unaffected mechanism.)
3. On output disconnect in `global-unique`, the disconnected output's
   former trailing-empty desktop is folded into the surviving primary
   output's assignment group by the existing `rebuildGlobalUniqueMapping`
   (`controller.ts:8936-8974`). Should it then be treated as that primary
   output's new trailing empty, or as an immediately cleanup-eligible extra
   (per Q5, no grace period) alongside the primary's own pre-existing
   trailing empty? Needs an explicit ruling before `unit-03b` starts.
4. On output connect (hotplug) in `global-unique`, should a fresh trailing
   empty always be created for the new output, or may an already-empty
   desktop from the global pool (e.g. one freed by a prior disconnect) be
   adopted instead of creating a new one?
5. "Currently active/focused output" - Lead's reading is this already maps
   to the existing `activeOutputForWorkspace()` convention
   (`controller.ts:8259-8277`: focused window's output, else
   `workspace.activeScreen`), used identically today by both
   `per-output-local` and `global-unique` navigation. Confirming no
   different definition is intended before `unit-03b` relies on it.
