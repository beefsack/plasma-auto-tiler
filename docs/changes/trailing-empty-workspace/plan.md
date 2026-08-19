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

**Mode domains**, per the current code survey:
- `per-output-local`: one domain per connected output (its own ordered local
  desktop-id list).
- `global-unique`: one domain (the global desktop list ordered by
  `x11DesktopNumber`).
- `shared`: one domain (the single shared desktop list).

Pending **Q-Domain** confirmation from the user before unit-02 starts.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification (static or live) |
|---|---|---|---|---|
| unit-01 | Shared "ensure exactly one trailing empty" invariant helper: structural trailing-empty identification, protect-from-cleanup exclusion, post-removal append-if-needed step, with its own idempotency/stability unit tests (no mode wiring yet) | - | `kwin/src/controller.ts` (new helper, not yet called); `kwin/tests/controller.test.ts` (new isolated helper tests) | static: `node --test` on new helper tests only |
| unit-02 | Wire `per-output-local` mode: cleanup path calls the helper per output; `Meta+0`/`Meta+Shift+0`/`finishWorkspaceZero`/`finishMoveToTrailing` local branches reuse-if-present; rewrite the affected "Unit 05" describe-block assertions | unit-01 | `kwin/src/controller.ts` (`reconcileLocalWorkspaces`, `removeOwnedEmptyDesktop`, `finishWorkspaceZero` local branch, `appendTrailingForOutput` call sites); `kwin/tests/controller.test.ts` ("per-output-local workspaces (Unit 05)" block, lines ~14604-15046) | static: full `node --test`; targeted stability test added |
| unit-03 | Wire `global-unique` mode: same shape as unit-02 for the global-unique domain and its describe block | unit-01 | `kwin/src/controller.ts` (`reconcileGlobalUnique`, `removeOwnedEmptyGlobalUnique`, global-unique `Meta+0`/`Meta+Shift+0` branches); `kwin/tests/controller.test.ts` ("global-unique workspaces (Unit 06)" block, lines ~15046-15444) | static: full `node --test`; targeted stability test added |
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
- [ ] unit-03 Wire global-unique mode (not started - no diff evidence)
- [ ] unit-04 Wire shared mode (not started - no diff evidence)
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

## Pending User Decisions

None outstanding. User ruled on all three surfaced ambiguities (2026-08-19),
matching the Lead's recommendation in each case; encoded in `spec.md`
Resolved Questions:
- Q-Domain: one trailing empty per output (`per-output-local`); one global
  trailing empty (`global-unique`, `shared`).
- Q-Zero: `Meta+0` is a no-op when already on the trailing empty.
- Q-Manual: non-trailing manual empties remain cleanup-eligible when
  invisible (self-healing, no identity tracking).

Q-Pager accepted as-is (not contentious). Q-MultiOutput is a test-coverage
requirement carried into unit-05, not a product decision. Q-Diagnostic-ID
resolved as a stale brief - the Orchestrator's prior-change addition already
covers it; nothing folded into scope.

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
- Remaining acceptance criteria (global-unique and shared domain wiring,
  cross-mode sweep, docs correction) are unit-03 through unit-06 and remain
  unmet pending those units.

## Residual Risks

- Oscillation risk under Q7's broadened dispatch triggers is the primary
  technical risk of this change; unit-01's stability tests are the main
  mitigation and should be reviewed closely before unit-02 begins.
- The shared-helper approach (one implementation instead of three) is a
  deliberate deviation from strictly mirroring the pre-Q6 per-mode
  duplication; if review finds mode-specific semantics do not fit a single
  helper cleanly, unit-01 may need to split before unit-02 starts.

## Final Outcome

- Pending - unit-01 and unit-02 accepted and staged (not committed); units
  03-06 remain. Not yet the change's overall completion transaction.

## Staging Note (2026-08-19)

- Staged (`git add`, not committed): `kwin/src/controller.ts`,
  `kwin/tests/controller.test.ts`, `kwin/contents/code/main.js` - the
  cumulative unit-01 + unit-02 diff vs. `884ff95`, verified 809/809 tests
  pass and typecheck clean. Proposed conventional-commit subject (subject
  only, for the user to use if they commit this now, or to hold until
  units 03-06 land): `feat(workspace): reuse trailing empty workspace in
  per-output-local mode`. `docs/changes/trailing-empty-workspace/` left
  untracked (process artifacts, still being edited across remaining
  units). No commit or push performed - user-only per commit protocol.
