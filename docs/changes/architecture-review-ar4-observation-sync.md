# AR4: Single observation sync

## Goal and scope

Move membership diffing and bounded reconcile/park policy from the KWin adapter into the portable Engine. One `sync` request should carry complete observations for all affected domains and return one plan, with removals before admissions, stable admission order, domain changes as remove plus admit, retained exception handling, and independent per-domain revisions, fingerprints, divergence and pending scope. Keep existing send/R4 acknowledgement and verification, fences, background adoption, placement-aware fitting, native focus/visibility behavior and correlated lifecycle summaries.

## Non-goals

No size-hint clamp acceptance, layout-policy seam, logical workspace model, transaction-model replacement, live KWin test, toolchain change, or edit to the dated architecture review.

## Approach and acceptance

- Establish existing foreground/background observation, reply and focus semantics before replacing adapter-derived admission/removal.
- Implement green slices across portable core, protocol wire/validation, and native observer/actuator, then retire dead adapter baselines and counters.
- Cover multi-window appearance, removal before admission, domain changes, flag transitions, drift/park, background domains, and in-flight send retention. Update byte-exact wire goldens and correlated lifecycle summaries.
- Verify workspace fmt/check/clippy/test, KWin typecheck/tests/build, `just check-portable`, and independent behavior review; report count and approximate TS line changes.

## Material decision

The existing adapter sends at most one membership command per round trip: `refreshForegroundNow` chooses the first new window in observation order, then chains later requests (`kwin/src/plan-adapter.ts:3071-3123`, `:6625-6662`). For a retained A followed by B and C together, the current route can display an intermediate A+B geometry before admitting C. Collapsing that intermediate write into one final plan is selected by the Orchestrator as a direct consequence of the user-requested review 7.7 ("one round trip and one Plan covering every affected domain"), reducing visible jank per `VISION.md`.

Preserve final admission order, native focus and desktop behavior, startup fitting, background anchors and independent per-domain state. Per-domain focus and revision reply fields are authorized in the combined reply because script and Planner ship from the same checkout; pin the change with byte-exact goldens (`crates/tiler-protocol/src/planner_protocol.rs:254-294`). Keep per-domain Sessions rather than merging them.

## Current outcome

Scoping and the user-visible coalescing decision are complete. The first core approach only derived intents without committing geometry and counted observation changes rather than unsuccessful reconcile attempts. The replacement commits through Session, but independent review rejected it as a production foundation: sequential cross-domain commits can return a stale earlier plan; synthesized observations bypass real fingerprint/input fences and cross-domain removal can copy the target fingerprint into the source; global pending deferral collapses independent scopes; the current wire lacks explicit exception flags; fresh startup bypasses near-strip fitting. Both semantic approaches failed and the experimental core diff was reverted; no AR4 code is in the tree. Do not repeat the synthetic-observation algorithm without addressing the review findings.

Next slice: establish a true validated multi-domain observation boundary with per-domain fingerprints, explicit exception flags and pending scopes; implement two-phase all-removals/all-admissions/final-projections through real Session observations and the existing fit path. Then add production wire/adapter integration and remove the TS baselines/counters. Preserve current per-domain revisions/focus and transaction fences. Update the `docs/decisions.md` adapter-baseline entry only when the sync route replaces it.

Keep this note active until AR4 passes acceptance and can be archived.
