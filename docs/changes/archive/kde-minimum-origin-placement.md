# KDE minimum-infeasible origin placement

- Status: delivered offline (2026-10-07); native checks user-owned.

## Goal and acceptance

- Deliver selected B6 on KDE: keep the logical tile, write its origin with
  each extent at least the observed declared minimum when it cannot fit.
- Feasible tiles stay unchanged; R-MIN-01..03-shaped fixtures cover admission,
  shrink/recovery and oversized sole windows. Repeated observations settle
  without write-fighting, including client clamps and Ghostty-class shortfalls.
- Structured diagnostics identify the effective minimum placement.

## Scope and approach

- KDE adapter and offline fixtures only. Reuse Windows effective-target
  semantics and existing hint validation/reconciliation; no core extraction.
- Preserve sequential long-edge startup fallback, Q3/R-MAX-03, B9 and Windows.
- Use the same effective target for ordering, equality, writes and settlement;
  preserve gap origins, domain ownership and native overlay precedence.
- Sequential units: investigate; implement with red/green regressions; independent
  review; offline gates and record reconciliation; commit/rebase/push.
- Read root guidance and live-KWin guide. Agents run no live host checks.

## Evidence and decisions

- Baseline clean; initial `git pull --rebase` up to date.
- Investigation: Windows `overconstrained_effective` raises only violated extents
  at the planned origin. KDE previously skipped ordinary and R4 transfer writes.
- No shared-core change needed. Existing bounded difference reconciliation and
  declared-limit clamp assessment must remain authoritative.
- Learned-limit experiment stays parked; no persistent learned hints introduced.
- Concurrent Windows work may update main; stop on a conflicting shared-core change.

## Delivered implementation and review

- `kwin/src/plan-adapter.ts`: `overconstrainedEffective` mirrors Windows;
  `effectiveTargetFor` reads fresh declared minima with existing meaningful
  range 1..16384. Unknown/sentinel hints do not become learned floors.
- Ordinary and R4 writes use effective targets in canonical grow-before-shrink
  order. Ordinary equality, applied evidence and pointer echo use the same
  targets; R4's existing forced source/target convergence re-homes evidence.
- `minimum-placed correlation=<id> window=<id> resource_class=<class>
  op=<op> rect=x,y,w,h` logs only successful raised writes, never equality or
  setter failure. Fullscreen/maximized/floating precedence stays intact.
- Readable hidden domains keep exact output/workspace write ownership without
  native focus or visibility changes; gap/offset origins stay intact. B6 may
  overlap siblings or overflow the work area, including another output's space.
- Host-shortfall fixture exposed an echo-reset livelock: quiet observations of
  our just-written target erased the bounded reassertion count before the host's
  later short frame. Preserve that count only for minimum-driven applied evidence,
  including unflagged minimum-satisfying projections held short by the host.
- Existing bounded acceptance adopts observed reality after three reassertions,
  logs `reconcile-accepted cause=stable-drift`, then stays quiet. Declared max
  clamp assessment and Ghostty-class unexplained drift remain distinct.
- Independent review: false placement logs corrected; pointer echo corrected;
  claimed R4 evidence blocker disproven by post-transfer quiet fixture. Review
  accepted the final diff with no remaining blockers.
- Review correction: broad quiet-reset suppression was rejected by Lead and
  narrowed to minimum-driven domain evidence. Flag-only guarding was insufficient
  for real Engine projections satisfying the minimum without an overconstraint
  flag; plan-at-floor/observed-shortfall guarding covers that case.
- Residual: continuously minimum-marked domains share the existing drift counter
  across quiet echoes/episodes, so later shortfalls may reach acceptance sooner.
  Feasible slack-domain reset behavior remains baseline; acceptance clears the
  marker, and subsequent projections/lifecycle replace or prune it. Review judged
  this bounded-safe; user-owned native convergence checks remain necessary.

## Verification and user-owned checks

- Red: five of six initial placement regressions failed against the prior skip
  behavior; sentinel guard passed. Log/echo regressions discriminated their
  review fixes; real-engine shortfall reproduced six consecutive reassertions
  before the accounting correction. Feasible-reset regression rejects global
  quiet-reset suppression.
- Green: `npm --prefix kwin test` 920 passed, zero failures; typecheck clean.
  Real-engine journeys cover newcomer, shrink/grow, oversized sole on offset
  hidden domain, declared-max clamp and minimum-effective host shortfall.
  Foreground interleaved echoes and hidden host-shortfall fixtures establish one
  admission plus three reassertions, then acceptance and silent observations.
- `cargo test --workspace --locked`: 1107 passed, zero failures.
  `cargo fmt --all -- --check` and strict workspace/all-target Clippy passed.
  Rust source stayed unchanged after those gates.
- `just check-portable` and `just build-kwin-script` passed after final source
  corrections; generated bundle uses the official build. Native Windows gate
  belongs to hosted CI; no native Windows execution on this Linux host.
- No live KWin/Plasma tests were run by agents.
- User: run the worktree via the documented dev loop, admit a minimum-bound
  newcomer, shrink/grow its available area, then try an oversized sole window.
  Record frames and tile origins, overlap/overflow and quiet settled logs.
- Repeat on a secondary output and hidden workspace, then check a Ghostty-class
  client. Preserve unrelated windows and restore through the documented dev loop.

## Succession

- Records: R-MIN-01..03 KDE cells, V-START-MIN, REQ-MIN-01..03/REQ-START-03,
  R-START-03 KDE cell and decisions B6 now point to offline delivery.
- Backlog handover only: B6 KDE implementation delivered offline; retain the
  user-owned native R-MIN-01..03 convergence/overflow acceptance. No backlog or
  principles edits made by this Lead.
- Exact next action: user runs the bounded native journeys above via
  `docs/dev-loop.md` and records origins, minimum extents and quiet settlement.
