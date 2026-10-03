# Windows placement correctness

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
- Live authority: user's 2026-10-03 autonomous assignment and standing brief;
  ordinary open windows may be controlled but never closed. Disposable
  Notepad/Calculator/Paint may be opened/closed. No registry/policy writes.
- Observability accepted: trace-only bounded startup inputs (8 opaque window
  tokens/rectangles), fit outcome/reason, resulting ordered H/V topology and
  nested shares (256 characters), and send branch/opaque leaf/projected
  rectangle/axis. Seeded fallbacks carry their resulting tree as well.
- Native locked build/test, strict all-target Clippy, rustfmt and diff checks
  passed after the final observability follow-up; no protocol reply changes.

## Candidate matrix rows

- Pending bounded investigation: clean 2x2 startup versus cascaded startup;
  infeasible minimum topology; remembered-leaf/focus-history/root workspace
  return; minimum-constrained maximize/restore sibling stability.
