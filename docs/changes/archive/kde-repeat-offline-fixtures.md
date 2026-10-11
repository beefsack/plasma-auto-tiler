# KDE offline repeat fixtures

## Goal and acceptance

- Close the offline portion of the Q8 queue brief for pending B-series native-change repeats and shortcut autorepeat, starting at clean HEAD `6a97317`.
- Pin recorded per-activation toggle behavior and repeated native notifications with the smallest existing-style KWin fixtures. Fix only a reproduced narrow defect; unsupported physical repeat semantics remain TBD.
- Native KGlobalAccel delivery and single-output/multi-output checks remain user-owned and pending.
- Full gates: KWin tests/typecheck/bundle, Rust workspace tests/clippy/fmt, native CTest, `just check-portable`, nine offline shell suites, independent review and `git diff --check`. Baselines: KWin 1238, Rust 1270, CTest 33/33.

## Approach and bounded units

1. Sequential investigation: locate B-series decisions, fixtures and gate commands.
2. Sequential implementation: add missing offline repeat fixtures, report exact covered rows and any undecided behavior or reproduced defect.
3. Inspect actual diff, add a minimal TBD discriminating row for unsupported physical repeat behavior and update the backlog.
4. Sequential verification, then fresh independent review; accept evidence, archive this note and publish intended files.

## Scoping evidence

- Q8 is the supplied queue label, not an existing backlog row. The mapped item is the B1/B2 pending native-change repeats and held-key autorepeat in `docs/backlog.md`.
- `docs/decisions.md` selects at most one native maximize/sticky attempt per explicit KDE activation, no persistent attempt map or automatic retry. It leaves physical KGlobalAccel held-repeat delivery for user acceptance.
- Existing same-reference native-change/repress fixtures cover one intervening native change, not repeated cycles. Inspect entry-level notification and shortcut callback seams before deciding the smallest remaining coverage.

## Accepted evidence

- Four KWin fixtures extend B1/B2 / R-MAX-04 / REQ-MAX-04 and R-FLT-02 / REQ-FLT-02: two native restore/restick cycles on the same reference, duplicate desktop notifications on a sticky float, and three registered Meta+M callback deliveries with counted native targets `[true, false, true]` and settled maximize readback.
- Duplicate sticky notifications coalesce into one required flag reconcile after sticky-on, then remain quiet after convergence; no automatic native toggle/retry. Existing maximize/fullscreen/geometry duplicate fixtures already cover R-MAX-01/02/03/06, so no redundant Rust/core fixtures were added.
- No product defect reproduced or source repair required. Fixture calibration corrected an initially zero-dispatch expectation to the recorded flag-reconcile behavior, and excluded the floating member from reconcile reply coverage. No unresolved semantic failure.
- Physical held-key callback delivery and any required KDE suppression policy remain TBD in a minimal R-MAX-04 / R-FLT-02 discriminator. No physical key fixture or live acceptance claimed. Backlog's offline scope advanced; native repeats and hold/release checks remain pending.
- Full gates: KWin **1242/1242**, 173 suites; Rust workspace **1270**; native **33/33** (matching cached Nix check log); TS typecheck/bundle, clippy/fmt, `just check-portable`, all nine offline shell suites and `git diff --check` pass. Logs retained. Native non-test derivation rebuilt; the unchanged tests derivation's successful CTest log was inspected.
- Fresh independent review accepted fixture contracts, source scope, TBD semantics, links and full-gate evidence. Its one minor records finding removed an uncited portable-test count copied from a previous record; the portable gate itself passed.
- Outcome: offline delivery complete; native repeats and held-key delivery remain user-owned, pending. Four sequential units (investigation, implementation, verification, independent review). Archived after acceptance.
