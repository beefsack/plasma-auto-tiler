# Windows placement correctness

- Status: implementation and automated/live-API verification complete
  (2026-10-03); provisional product review and physical dogfood remain user-owned.

## Goal and acceptance

- Resolve dogfood D1 (startup strips), D4 (admitted but unmoved minimum-size
  conflicts), D5 (workspace-return anchor/axis), and D2 (maximize sibling drift
  and delayed restore). KDE/shared Engine behavior is the reference.
- Establish trace-only startup rectangles, fit outcome/reason, selected tree
  and shares, and send anchor branch/axis using bounded opaque identifiers.
- Reproduce and verify four/five-window starts with real native minimums,
  maximize/restore, and send-away/return with recorded destination focus.
- Native locked build/test, strict all-target Clippy, rustfmt and hosted
  Rust/KWin/shell/Windows CI must pass for each accepted implementation unit.
- Preserve hosting Terminal and user windows; finish without project processes,
  overlays, ledger or hidden windows; arranging=1, pen visualization=35.

## Scope and approach

- Shared placement policy and Windows actuation/reconciliation only; no shortcut
  containment, settings, dependency installation or broad topology optimizer.
- Sequential bounded units: observability; live reproduction and policy evidence;
  smallest justified fixes with regressions; independent review; live verification.
- Product choices without a clear KDE answer are reversible and recorded in
  `docs/decisions.md` as "provisional, to discuss".
- User physical acceptance remains distinct from synthetic/API verification.

## Evidence and current state

- Baseline `6a48152`, clean tree. Diagnosis 2026-10-03: D1's minimums fit the
  strip, so they did not force its topology. D4 reserved infeasible tiles and
  skipped three writes. D5 projected anchors were wide but anchor branch was
  unlogged. D2 changed sibling allocation on maximize and restored asynchronously.
- Existing overlap centre-fit is explicitly approved KDE policy (2026-09-29);
  any revision must preserve clean pre-tiled adoption and state the shared impact.
- Live authority (user 2026-10-03): ordinary open windows may be controlled
  but never closed. Disposable
  Notepad/Calculator/Paint may be opened/closed. No registry/policy writes.
- Observability accepted: trace-only bounded startup inputs (8 opaque window
  tokens/rectangles), fit outcome/reason, resulting ordered H/V topology and
  nested shares (256 characters), and send branch/opaque leaf/projected
  rectangle/axis. Seeded fallbacks carry their resulting tree as well.
- Native locked build/test, strict all-target Clippy, rustfmt and diff checks
  passed after the final observability follow-up; no protocol reply changes.
- Observability commit `174e70b`: hosted Rust/KWin/shell/Windows CI green
  ([run](https://github.com/beefsack/OmniTiler/actions/runs/37120915569)).
- Real four/five-window reproduction logs:
  `%LOCALAPPDATA%/omnitiler/session-1/run-01dd532db76a8af6.log` and
  `run-01dd532e5c7fa523.log`, payload SHA256
  `0C5C5E314F3242FC5D97E1831D1A6B16FEF13C12AE4703DDBF043748FAA59149`.
  Five-window cascade fitted with four centre splits, but Paint's 448px tile
  height violated its 617px minimum and Calculator's 592px violated 627px;
  three writes succeeded, two stayed at pre-start positions for 19 ticks.
- D2/D5 proof report: temporary `d2d5-20261003-220707-17764/d2d5-report.json`.
  D2 hint-bound equal-share strip fixture redistributes all leaves when the
  maximized member's hint disappears; hintless live control stays stable.
  Win+M restore dispatch tick 8 was followed by ordinary plan tick 9.
  D5 populated returns selected remembered leaves, tall 1268x1364 -> stacked,
  wide 2544x678 -> side-by-side. This matches the existing shared rule, not
  a Windows-specific defect. Original dogfood anchor cannot be recovered.

## Material choices

- Provisional, to discuss: preserve clean cut startup adoption; decline
  centre-split cascade inference to ordinary deterministic long-edge seeding.
  Decline a minimum-infeasible fitted startup topology to the same seed path.
  This shared policy changes KDE and Windows together; no topology search.
- Provisional, to discuss: on Windows, if allocation still cannot fit declared
  minimums, place admitted windows at their tile origin with extent at least
  the native minimum, rather than reserve space and skip movement. Overlap
  remains possible when no fitting seed results. Current KDE adapter also skips
  overconstrained writes; the native-minimum placement is an explicit Windows
  correction, not claimed current adapter parity.
- D5: retain remembered-leaf -> focus-history -> root and projected long-edge
  axis; recorded proof establishes this rule, not the original unlogged anchor.
- D1/D4 implementation accepted after native gates and independent review:
  centre-split/min-infeasible startup fits use existing seeding; Windows native
  overconstrained placement uses known minimum extents at the planned origin
  consistently through equality, writes, refusal and readback. Four-window
  sequential insertion is a long-edge bisection chain, not guaranteed 2x2.
  Real-five hinted regressions fit four focus choices; Paint focus leaves two
  335px-high logical tiles, now covered by native minimum-clamped actuation.
  Clean hinted 2x2 remains fitted and identity-stable. Review found no blocker;
  missing-hint overconstraint is unreachable in current assemble/apply paths.
  Residual: minimum-clamped windows can extend beyond work area, not just overlap.
- D1/D4 commit `2c918d3`: hosted Rust/KWin/shell/Windows CI green
  ([run](https://github.com/beefsack/OmniTiler/actions/runs/37123627664)).
- D2 accepted: tiled overlays reuse lifetime-bound last-known minimum hints.
  Async restore arms a bounded completion wake, consumed only after gated
  reconciliation; key-up dispatch/gesture/suspend cannot prematurely clear it.
  Native gates pass. Regression proves removing a binding hint changes all
  four strip allocations, retention preserves them, and completion survives
  a concurrent dispatch before reconciliation. Initial wake implementation
  cleared before dispatch routing; review caught and corrected this before
  acceptance. No failed product semantic approach was accepted.
- D2 commit `4a636ae` contains the live-verified source diff: hosted
  Rust/KWin/shell/Windows CI green
  ([run](https://github.com/beefsack/OmniTiler/actions/runs/37125264718)).

## Live verification outcome

- Final implementation payload on `2c918d3` plus D2 source diff, SHA256
  `95EE37EDEEC43254C2612DEDF54BC81EF0657BBCDABF6890F034EB396BCFE488`.
  Windows 11 build 26200, session 1, medium integrity 8192, one physical
  2560x1440 monitor at 125%, work area 2560x1380, gaps 8. Exact identities,
  baselines, launch arguments and stop/restore receipts retained under temporary
  `worker-20261003-225703-29012/`; production logs contain only opaque tokens.
- Clean real-app 2x2: `tile5-run.log` tick 1 fitted with zero centre splits,
  identity-stable 1268x678 allocations, all minimums satisfied; no six-second
  write churn. The fifth app in this run was an incremental admission, not
  five-window startup; only subsequent fresh runs establish that acceptance.
- Cascade four: `runA-tick1.log` / production `run-01dd5337d5dbc7ca.log`,
  four already-open windows, three centre splits declined, resulting
  `H[1,1](L,V[1,1](L,H[1,1](L,L)))`. Four writes, zero mismatches, all real
  minimums satisfied, no further writes over six seconds. Sequential layout
  is a bisection chain; the original four-column dogfood input is unavailable.
- Cascade five with Paint pre-start foreground independently verified:
  `runB-tick1.log` / production `run-01dd53380f3362ae.log`, four centre splits
  declined. Paint/Calculator logical tiles had 335px height; actual writes
  kept their origins and raised heights to 617/627px. All five readbacks
  matched effective targets, no overconstrained skips, five writes then no
  churn over six seconds. Paint bottom reached y=1654, below work-area y=1380:
  explicitly observed residual of the provisional origin/minimum policy.
- Real-app native maximize/restore: Paint retained 864x617 hints with
  `reason=retained-hint`; all four sibling actual and desired rectangles stayed
  byte-identical, no writes during maximize; restore regained the exact slot
  and normal fresh hint query. Native state changes observed in approximately
  22ms polls. This tests minimum-binding placement without shortcut injection.
- Marked shortcut proof `d2d5-20261003-230127-4376/d2d5-report.json`: Win+M
  restore dispatch tick 8, first reconcile/readback tick 9, confirmed tick 10,
  exact slot return. Nominal pump is 100ms; no measured wall-clock latency
  claim (observer polls were 200ms). D5 remembered tall return stacked at
  1268x1364, remembered wide return side-by-side at 2544x678, both focus and
  readback successful. Logs `run-01dd53374eb38cd6.log` and
  `run-01dd53375205c58e.log`; product injected-input filtering unchanged.
- Verification corrections: an initial test report incorrectly called an
  incremental fifth admission a fresh cascade/min-clamp test; direct inspection
  rejected that claim and two fresh runs supplied the missing evidence.
  A Calculator activation attempt failed once and was not escalated; a
  temporary inventory redirection pipe error received one temp-only repair.
- Cleanup: all owners stopped by exact identity and independently restored;
  no project owners/helpers/overlays, ledger/request files or hidden windows.
  Arranging=1, pen visualization=35, taskbar visible. All newly opened
  Calculators closed; baseline three Notepads and Paint left alive, visible,
  unminimized/unmaximized with unchanged process identities. Pre-existing extra
  Notepads preserved because title alone cannot establish empty content.
  Hosting Terminal/process tree never closed, killed or typed into.

## Remaining user-owned acceptance

- Physically judge cascade sequential layout versus a desired balanced 2x2,
  five-window origin/minimum placement and overflow tradeoff; approve/revise
  the precisely recorded provisional choices.
- Physical Win+M/native-button maximize/restore timing, sibling stability and
  send-away/return with recorded destination focus; current desktop synthetic
  API/log evidence does not establish physical feel.
- KDE dogfood of the shared startup-policy revision; hosted KDE fixtures pass,
  but no live KDE test was possible in this Windows session.

## Candidate matrix rows

- Startup-clean-4: four contained non-overlapping windows in 2x2, fit-capable
  minimums; enable tiling, disable/re-enable. Observe identity/order/topology,
  allocation and movement; compare clean adoption with sequential remap.
  Local COSMIC `src/shell/workspace.rs:1441-1452` maps floating windows
  sequentially, not rectangle-to-tree inversion (local source read verified).
- Startup-cascade-4: four overlapping/cascaded never-tiled windows, minimums
  fitting a 2x2; enable tiling. Observe inferred centre cuts versus long-edge
  sequential seed, final axes and identity order. Our original shared Engine
  can select an input-driven strip or nested layout; KDE receives the same
  result for the same inputs. No reference live answer established.
- Startup-minimums-5: cascade of three 401x246 Notepads, Paint 864x617,
  Calculator 402x627 in 2544x1364 with 8px gap; enable tiling. Observe topology,
  feasibility fallback, skipped/floated/minimum-clamped writes, final origins
  and overlap. Local KDE adapter `kwin/src/plan-adapter.ts:7438,7469-7476`
  skips overconstrained writes; no local upstream KWin compositor checkout
  establishes its below-minimum setter result.
- Return-anchor-axis: populated workspace 1, empty workspace 2, known
  destination focus; send subject away, select destination to focus a tall
  leaf, select away and return subject; repeat with wide leaf. Observe
  remembered/MRU/root branch, leaf identity, projected rectangle, axis/order
  and focus follow. Local COSMIC `src/shell/layout/tiling/mod.rs:417-436,
  548-616` uses last-active target and its long edge; no-focus uses root/output.
  Our proof returns used remembered tall then remembered wide leaves correctly.
  Repeat after the remembered leaf leaves the destination to observe valid
  focus-history fallback, and without any valid destination focus to observe
  root fallback; these branches remain source/test-established, not live-proven.
- Maximize-minimums: four minimum-bound equal-share strip leaves with minimum
  widths 401/864/627/582 in 2544px; maximize then restore each hinted member,
  cross-check native maximize/restore. Observe sibling desired and actual
  stability, retained hints, restore-dispatch/convergence latency and overlap.
  Local shared `size_hints.rs:250-305,377-419` reallocates if binding hints
  disappear; pre-fix Windows retained rows dropped hints. Final Windows retains
  them and real-app siblings stayed stable. External reference-WM maximize
  outcomes are unestablished locally; record their allocation/restore behavior.

## Completion and succession

- Final readback: zero project actors,
  no ledger/stop/workspace requests, arranging query=true/value=1,
  pen query=true/value=35, taskbar visible. User application identities and
  visibility verified by the final live check; user windows remain arranged.
- Proposed backlog replacement: "P1 | Windows placement physical acceptance |
  D1/D4 startup and minimum-placement corrections, D2 retained hints/prompt
  restore delivered; D5 remembered projected-long-edge rule verified. Review
  provisional cascade/minimum-overflow choices and physically dogfood Win+M
  and send returns; evidence in archived windows-placement-correctness."
- Exact next action: move Candidate matrix rows into the matrix
  document and advance the backlog; user reviews the provisional choices and
  runs the physical checks above. No remaining implementation action.
