# D8: carry workspace migration overlays

## Goal and acceptance

- Deliver migration D8 in shared core/Linux planner and KDE: carry fullscreen
  and maximized members; affected-view overlays do not refuse migration.
- Fullscreen receives only native output movement, with no extra geometry or
  focus writes. Maximized members keep their overlay and reserved tile slot.
- Preserve D1-D7/D9, verified arrival, native re-fit convergence and identity
  fences. Log carried overlays without raw window IDs. Windows is docs-only.
- Offline only; no dependencies or live mutations.

## Units and verification

- One sequential muse-spark implementation Worker: inspect migration paths,
  make the smallest core/KDE change and meaningful regression coverage.
- Lead integrates decisions/spec/reference/backlog and Windows handoff docs.
- One independent muse-spark review Worker; resolve concrete findings.
- Full KWin TS, Rust workspace, native CTest, clippy, fmt, portable,
  typecheck/bundle and offline shell gates; whitespace check.
- After accepted evidence and review, archive this note, commit and push.

## Lead choices

- D8's fullscreen no-focus-write rule takes precedence over an explicit D6
  activation write for an already-active fullscreen member. Follow/verification
  remain; focus is left to KWin. Log `native-only`, not confirmed client focus;
  native focus retention remains TBD in the R-WS-25 discriminating legs.
- Native overlay re-fit may change geometry; arrival must verify identity,
  membership and output rather than require the old overlay rectangle.
- Keep frozen-state/identity fences: planning-window mode changes settle and
  reconcile normally. Immediate live guards suppress geometry/focus writes
  that would otherwise touch a newly overlaid/fullscreen member.

## Evidence and outcome

- Starting HEAD `365ab03`, clean worktree; required guidance and original
  migration record read. No live acceptance claimed.
- Core/planner and KDE carry overlays with retained slots, no unmaximize and
  native-only fullscreen movement. Related transients ride native movement;
  affected views no longer policy-refuse. Unexplained fit-excluded observations
  retain their narrow refusal. Carried-class counts are redacted dispatch
  diagnostics with `outcome=started`, not claimed native completion.
- Independent review found stale-snapshot geometry/focus write races. Repaired
  with immediate live reads and transfer/deferred/follow regressions; final
  review passed. Its diagnostic follow-up was closed with `native-only`.
- Final gates: KWin 1225/0 (172 suites), Rust workspace 1269/0, typecheck,
  bundle, workspace clippy `-D warnings`, fmt and `just check-portable` pass.
  Binary offline build passed. Fresh Nix native-effect-tests CTest 33/33 passed;
  stale local native build directories were superseded, not accepted evidence.
- Offline shell suites passed: dev-native-effect 163/0, nix-host-kwin-build
  93/0, build-kpackage contract, custom-tile-acceptance 131/0,
  dev-loop-split 380/0, dogfood-install 572/0, floor-ratio-feasibility 92/0,
  live-test mock 237/0 and tray-05b 29+16. Whitespace/added-line ASCII clean.
- Decisions delivery status, REQ-WS-12/f/h, Ours matrix and Windows item-14
  handoff updated. Empty P0 decision-changes item removed. Q4 live check now
  explicitly includes D8 fullscreen/maximized migration, native focus/re-fit,
  slot restoration, affected views and mid-flight state changes (all TBD).
- Topology: Lead plus two sequential muse-spark Workers (implementation,
  independent review/verification), resumed for fixes; one active at a time.
