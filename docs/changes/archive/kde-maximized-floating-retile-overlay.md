# KDE maximized floating-to-tiled overlay (R-MAX-03 Q3 scope)

- Status: delivered offline (2026-10-07); native acceptance user-owned.

## Goal and acceptance

- Deliver the recorded 2026-10-07 Q3 scope decision: a first-seen maximized
  window on a floating workspace keeps native maximize when toggled tiled,
  reserves a tile slot and lands there on native unmaximize.
- Fixtures prove sibling allocation, normal non-maximized retile, quiet
  repeated maximize signals, synchronous write signals and interaction with
  the existing born-maximized R-MAX-06 path.

## Scope and approach

- KDE adapter and offline fixtures only; reuse the retained-slot projection,
  `fit_excluded` and `skip-maximized` mechanism from `9b612be`.
- `clearMaximizeAtAdmission` now permits a clear only on first exit of an
  exact-ref held born-fullscreen window. Its one-shot clear/echo/refetch path
  remains. Q3 retile performs no native maximize setter or overlay geometry write.
- Remove obsolete first-domain origin tracking: R-MAX-03 and R-MAX-06 now
  share the same overlay rule. No new state, retry mechanism or Engine change.
- Preserve B6 origin+minimum, born-fullscreen isolation, B9 intentional-float
  semantics and existing signal/debounce/single-flight fences.
- Sequential unit: one `muse-spark` Worker implemented code/fixtures; Lead
  reviewed the full diff, simplified the held-exit gate, strengthened allocation
  and signal-settlement assertions, ran final gates and reconciled records.
- Recorded decisions and historical delivery records remain authoritative;
  this record supersedes the prior R-MAX-03 one-shot implementation status.

## Accepted offline evidence

- Real same-process `planner_eval` replies reserve A's slot and B's disjoint
  share on retile; only B receives a native geometry write while A is maximized.
- A deliberately wrong native restored frame receives the exact reserved
  rectangle; B retains its share. Synchronous geometry/maximize write signals
  do not interrupt application, and converged observations dispatch/write nothing.
- Repeated maximize signals issue no native clear/toggle or repeated plans.
  A later born-maximized newcomer reserves a slot and settles through the same
  path; existing born-maximized foreground/hidden fixtures continue passing.
- Normal non-maximized retile writes both members. Hidden retile keeps its
  maximize overlay; reused ids and later floating visits introduce no clear.
- Existing held-born-fullscreen first-exit clear and one-shot suppression tests
  remain passing. B6 minimum-placement and host-shortfall regressions run in
  the full suite.

## Verification

- `npm --prefix kwin run typecheck`: pass.
- `npm --prefix kwin test`: 921 passed, 0 failed, 124 suites (includes build).
- `cargo test --workspace --locked --offline --quiet`: 1107 passed, 0 failed,
  0 ignored across 43 test binaries/doc-test groups.
- `cargo fmt --all -- --check`: pass.
- `cargo clippy --workspace --all-targets --locked --offline -- -D warnings`: pass.
- `just check-portable`: pass; zero normal core dependencies, no platform leaks.
- `git diff --check`: pass; added lines ASCII only.
- No live KWin/Plasma tests, session boundaries, dependency installations or
  shared Rust/core/Windows edits. Windows parity (b) remains the Windows agent's
  work; native launch/toggle/restore/session-restore outcomes remain TBD.

## User-owned live acceptance - Pending

- Follow `docs/live-kwin-testing.md` and `docs/dev-loop.md` after user delivery
  of this checkout. Record native flags, actual frames and bounded plan trace
  for maximized A without a tile slot beside ordinary B on a floating workspace.
- Toggle workspace tiled: A stays maximized, its planned reserved rectangle
  carries `skip-maximized`, B takes its tile share, and no clear/toggle occurs.
- Natively unmaximize A: its actual frame lands in that reserved rectangle,
  B keeps its share. Repeat native maximize/unmaximize and verify quiet idle,
  no unsolicited state changes or geometry fighting.
- At a user-owned session boundary, repeat with a session-restored maximized
  A: retile keeps maximize over the reserved slot, unmaximize reveals it and
  no re-maximize loop occurs. Restore the scoped baseline.
- Exact next action: user performs this pending R-MAX-03 native journey;
  backlog and functional-spec KDE cells record offline delivery only.
