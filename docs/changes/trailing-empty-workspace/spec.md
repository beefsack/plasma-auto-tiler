# Specification: Trailing Empty Workspace (COSMIC-style reuse)

Ownership and approval:
- Owner: Lead (lead-anthropic)
- Status: Approved (user rulings on Q-Domain, Q-Zero, Q-Manual recorded below;
  Q-Pager accepted as-is; Q-Diagnostic-ID resolved, no scope change)

## Intent and Desired Outcome

Replace the create-on-demand empty-workspace model delivered by
[workspace-management-fixes](../archive/2026-08-19-workspace-management-fixes/)
with a COSMIC-desktop-style model: exactly one trailing empty workspace is
always maintained after the populated ones. `Meta+0`/`Meta+Shift+0` reuse that
pre-existing trailing empty instead of always creating a new one. A fresh
trailing empty is appended only when the current one becomes occupied.

This reverses the prior Q6 ruling ("always create new, never reuse, no
exceptions") and only that ruling. It builds on top of, and must not regress,
the ownership-independent cleanup-eligibility fix and the Q7 broadened cleanup
triggers delivered by the same prior change.

## Scope and Non-Goals

In scope:

- A structural (not identity/ownership-tracked) "exactly one trailing empty"
  invariant, recomputed fresh on every `cleanupDesktops()` dispatch, for each
  of the three `workspaceMode`s (`per-output-local`, `global-unique`,
  `shared`).
- Protecting the trailing empty from the existing invisible-empty cleanup
  rule.
- Changing `Meta+0` and `Meta+Shift+0` (and their per-mode finish/deferred
  handlers) to reuse the existing trailing empty when present, appending only
  when none exists or the existing one is not usable per the applicable
  behavior for pressing while already on it (see Q-Zero below).
- Appending exactly one new trailing empty when the current trailing empty
  becomes occupied (any window lands on it, by any means: manage, move,
  drag).
- Anti-oscillation guarantee: repeated `cleanupDesktops()` dispatches against
  an unchanged desktop state produce no net create/remove churn.
- Rewriting/removing the ~34 assertions (~90+ tests, see Test Impact) across
  the five affected `describe` blocks in `kwin/tests/controller.test.ts` that
  currently encode "always create, never reuse, no reserved trailing
  capacity", and adding new stability/oscillation regression tests.
- Correcting the four `docs/roadmap.md` passages (174, 180, 185, 242) and the
  backlog entry describing the create-on-demand rule as settled, as part of
  this change's completion transaction (not before user acceptance).

Non-goals:

- No change to the ownership-independent cleanup-eligibility rule itself
  (any empty, invisible-on-every-output desktop remains removable regardless
  of who created it) - the trailing empty is the only new protected
  exception.
- No change to Q5 (no grace period on output disconnect) or Q7 (cleanup
  fires on all `cleanupDesktops()` dispatch events).
- No change to the "last remaining global desktop is never removed" floor.
- No reintroduction of any in-memory ownership/identity tracking (e.g. the
  removed `ownedDesktopIds` pattern). The trailing empty must be identified
  structurally (last-positioned empty desktop in the relevant domain order)
  on every pass, never cached across dispatches.
- Bug 1's Q4 KGlobalAccel item, the layout-correctness launch blocker, and
  the duplicated-diagnostic-read inefficiency are out of scope unless
  explicitly folded in below.

## Applicable Principles and Decisions

- `docs/decisions.md` has no entry directly governing workspace lifecycle
  policy; this is a product-behavior change, not a decisions-file change.
- `docs/roadmap.md#6-dynamic-workspaces` currently documents the model being
  reversed and will need correction as part of completion.

## Constraints

- Do not reintroduce ownership gating of any kind on cleanup eligibility.
- Do not weaken Q5 (immediate output-disconnect eligibility, no grace
  period) or Q7 (broadened dispatch triggers).
- No debounce, timer, or deferred-settle mechanism as an anti-oscillation
  fix. Convergence must be a property of a single `cleanupDesktops()` pass
  recomputing state fresh, not a rate-limiting workaround.
- Follow the existing per-mode structure in `controller.ts`
  (`per-output-local`, `global-unique`, `shared`) rather than merging modes
  that are intentionally distinct.

## Acceptance Criteria

- [ ] In every `workspaceMode`, after any sequence of window/desktop
      lifecycle events, exactly one empty trailing workspace exists per
      relevant domain (per-output in `per-output-local`; one global trailing
      empty in `global-unique` and `shared`), never zero, never more than one
      from this mechanism's own action.
- [ ] The trailing empty is never removed by cleanup while it remains empty,
      regardless of visibility, in addition to the existing "visible
      anywhere" protection.
- [ ] All other empty, invisible-on-every-output desktops remain removable
      exactly as today (ownership-independent, Q7-triggered) - including
      extra empty desktops a user creates manually that are not in the
      trailing position.
- [ ] The last remaining global desktop is never removed (unchanged floor).
- [ ] `Meta+0` switches to the existing trailing empty when one exists and
      is not already current; it is a no-op when the trailing empty is
      already the current desktop; it creates only when no trailing empty
      exists.
- [ ] `Meta+Shift+0` moves the focused window to the existing trailing empty
      when one exists; it creates only when no trailing empty exists.
- [ ] When a window lands on the current trailing empty by any means
      (manage, move, drag), exactly one new trailing empty is appended
      before the next dispatch settles.
- [ ] Repeated `cleanupDesktops()` dispatches against an unchanged desktop
      state are idempotent: zero net desktop creates or removes on the
      second and subsequent dispatches (stability/anti-oscillation test).
- [ ] No in-memory ownership/identity Set is introduced to track the
      trailing empty; it is recomputed structurally each pass.
- [ ] All 802 pre-existing tests either still pass unchanged or are
      deliberately updated to reflect the new reuse semantics, with no
      accidental regression to unrelated behavior (float/sticky, maximize,
      fullscreen, resize, drag reorganisation, etc.).
- [ ] `docs/roadmap.md` and the relevant `docs/backlog.md` entry are
      corrected to describe the trailing-empty-reuse model as part of this
      change's completion.

## Resolved Questions

- **Q-Domain (decided)**: One trailing empty per output in
  `per-output-local` mode; one global trailing empty in `global-unique` and
  `shared`. Matches `per-output-local`'s existing independent-per-output-list
  design and the old (pre-Q6) `removeOwnedEmptyDesktop`/reconcile pattern
  this reverts to.
- **Q-Zero (decided)**: `Meta+0` is a no-op when the trailing empty is
  already the current desktop - stay put, do not create a second empty. No
  unbounded growth from repeated presses.
- **Q-Manual (decided)**: A manually created empty workspace that is not in
  the trailing position stays cleanup-eligible if invisible, exactly as
  today. Only the last-positioned empty (in domain order) is protected as
  "the" trailing empty. The system self-heals back to exactly one trailing
  spare without new logic. No identity tracking of manually created
  desktops - that tracking is precisely what caused the original orphan
  bug (`ownedDesktopIds`).
- **Q-Pager (accepted as-is)**: The trailing empty appears in the KDE pager,
  unavoidably - it is a real `VirtualDesktopManager` desktop, identical to
  how every desktop this plugin creates today already appears in the pager.
  Matches COSMIC's own pager behavior (workspace 5 is visible).
- **Q-MultiOutput**: In `per-output-local` mode with multiple outputs, could
  an output's trailing empty and another output's mid-list empty (protected
  only by the existing visibility rule) ever be adjacent/confusable? Lead's
  read of the code finds no conflict - the two protections are independent
  and additive - but this needs explicit multi-output test coverage since
  it was not previously exercised under Q7's broadened triggers. (Test
  coverage requirement, not a product decision; tracked in
  unit-05.)
- **Q-Diagnostic-ID (resolved, no scope change)**: The Orchestrator's brief
  describing `workspace-cleanup-removed` diagnostics as missing a desktop ID
  was stale - a prior Lead already added the ID during the previous change.
  Current code (`controller.ts:8259,8394,8721`) already logs
  `workspace-cleanup-removed:${id}`. Nothing folded into scope.

## Consequential Decisions

- Q-Domain, Q-Zero, and Q-Manual rulings above are binding for units 02-05:
  per-output trailing empty in `per-output-local`; global trailing empty in
  `global-unique`/`shared`; `Meta+0` no-op on current trailing empty;
  non-trailing manual empties remain cleanup-eligible when invisible.
