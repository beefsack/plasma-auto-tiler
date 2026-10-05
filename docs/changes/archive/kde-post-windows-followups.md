# KDE post-Windows follow-ups

- Goal: deliver the authorized B1/B2 local toggle repair and B3-B5 KDE fixture coverage, then answer the user's minimum-infeasibility and admission-maximize/game questions with source evidence.
- Scope: `kwin/src/plan-adapter.ts` local toggle fences, relevant KWin tests, research/matrix and durable decisions. No Windows source changes, shared-core/protocol changes, live host tests, commits or pushes. Preserve pre-existing `devenv.nix`, backlog and audit/matrix work. B7 is a separate brief.
- User decisions 2026-10-05: one native attempt per discrete KDE activation, no persistent toggle-attempt map or automatic retry; no new core extraction until macOS starts; order B1/B2, B3-B5, B7 A/B, B8. B6/B9 questions authorize research only.
- Acceptance: regression fixtures first demonstrate native-change/repress refusal; smallest local repair preserves exact-reference echo, admission-time one-shot clearing, refusal/focus/diagnostic behavior; gap-inheritance and startup-decline fixtures exercise the real KDE observation/Planner-Engine seam; existing MRU fallback fixture reviewed without redundant additions; relevant offline TS typecheck/build/tests pass.
- Units, sequential `muse-spark`: B1/B2 tests and local repair; B3-B5 fixture coverage; read-only reference-WM/current-source investigation for Q2/Q3. Lead reviews evidence and integrates records. Escalate before any shared-core/protocol edit or nonlocal defect repair.
- Verification: fixture red/green evidence, KWin `npm --prefix kwin run typecheck`, `npm --prefix kwin test` (includes build), `just build-kwin-script`, `git diff --check`; no separate Rust gates unless Rust is changed. Physical KGlobalAccel repeat delivery remains user-owned.
- Research evidence: current adapter/core code and existing Windows gaming record for anti-cheat claims. All eleven requested reference-WM clones are absent on this laptop; their minimum/born-max outcomes remain TBD, with historical records explicitly labelled. No automatic-floating or maximize-policy change is selected.
- Outcome: B1/B2 delivered offline; B3-B5 coverage delivered; current-project Q2/Q3 research recorded in the [audit appendix](../../research/cross-platform-core/post-windows-audit.md#2026-10-05-follow-up-q2-minimum-infeasibility--q3-games). Local reference-source comparison is blocked on checkout locations/pins. B7 not started.

## Accepted implementation and fixture evidence

- B1/B2: four public-path, same-reference native-change/repress regressions (maximize after native restore, restore after native maximize, tiled-origin sticky-on after native unstick, float-origin sticky-off after native restick). Worker ran them before the source repair: all four failed because the second native attempt was absent. After repair all four pass; the adapter suite passed 196 tests. Existing no-echo/incomplete-observation and failed-write tests now assert per-activation behavior rather than persistent suppression.
- Repair: remove `maximizeToggleAttempts` and `stickyAttempts` plus their suppression/cleanup paths only. Keep exact-reference echoes, refusal/focus gates, keep-above origin handling and diagnostic lines. The two stale `*-refused-attempted` paths intentionally disappear. `maximizeAdmissionAttempts` and admission policy remain unchanged. No held-repeat state added.
- B3: real KDE send to unretained ws-4 with outer gap 8, membership/follow/focus/native projection proof, then retained hidden reconcile succeeds at inherited gap 8.
- B4: existing MRU survivor fixture asserts stacked geometry/axis, membership/four follows/focus/flight release; no redundant test added.
- B5: real hidden KDE adoption -> Planner codec -> Engine -> adapter apply. Cascaded overlap yields the distinct sequential-seed identity/rectangles and native readback. The same clean side-by-side frames with 700-wide minima decline to seed and produce zero native writes; 100-wide minima preserve identity fit, with subsequent native drift/reconcile proving actual retained writes/readback.
- Fixture calibration: chained hidden replies must be drained before reading ws-4; non-inset probe frames test invalid geometry rather than fit decline. A feasible fit preserves observed proportions and already-equal frames legitimately skip writes, so native write proof uses later drift/reconcile. These were fixture expectation/observation corrections, not product defects or source workarounds. No KDE defect surfaced by B3-B5.

## Offline gates

- Worker: `npm run typecheck` and `npm test` from `kwin/` after final fixture changes: **843 passed, 0 failed, 119 suites**; fixture file **17 passed**. `npm test` includes bundle build. Lead re-ran `npm --prefix kwin run typecheck` and `just build-kwin-script`: pass.
- `git diff --check`: pass. No separate formatting/lint script exists in `kwin/package.json`; existing TS style reviewed. No Rust source changed, so no broad Rust gates; real Planner fixtures compile/run the existing Rust example offline.
- Scope verification: user `devenv.nix` SHA256 `01cac261335c0ca99cc928b2b73e8307facc3f6c10e56eb4132afb2abca361da` and backlog SHA256 `f8258580d99bb5f5150bfb8a6573dd3365efcaa0311b68c22138a19c5edc3c74` unchanged from assignment start. No Windows/core/protocol source edits, live tests, commits or pushes.

## User-owned laptop checks

- Under the [live KWin protocol](../../live-kwin-testing.md), after user-owned delivery of this checkout: Meta+M maximize, native restore, Meta+M again; repeat the inverse native-maximize/shortcut-restore ordering. Verify one native attempt per activation and correct final state.
- Meta+Shift+G sticky-on, native unstick through KDE, activate again; repeat sticky-off/native-restick/activate, using both tiled-origin and ordinary-float cases. Check visibility, geometry/origin rules and exact subject focus.
- Hold/release Meta+M and Meta+Shift+G. Record any repeated KGlobalAccel activations/visible cycling; discrete physical delivery is not established by fixtures and no repeat machinery was added.
- Fullscreen refusal, ordinary repeated toggles and focus retention should remain intact. Compare issued/invoked/observed diagnostics rather than treating a setter return as effect proof.

- Independent review: no source/test blocker; once-per-activation, echo/focus/admission invariants and real Engine/native-write fixtures confirmed. Corrected the matrix's unpinned R-MAX-03 source ranges after the local deletions shifted lines. No product changes were needed after the final passing gates.
- Workers: four sequential `muse-spark` sessions (toggle repair; coverage, resumed for stronger write assertions; research, resumed to qualify hint dispatch/fullscreen gates; independent review). Requested routing is visible; actual provider model identity is unavailable.
- Next action: user laptop B1/B2 acceptance and supply reference-WM checkout locations/pins for remaining Q2/Q3 comparison. B7 requires the separate Orchestrator brief; minimum/launch-maximize alternatives still require a user decision.
