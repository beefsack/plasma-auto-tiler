# COSMIC reference outcomes

## Goal and scope

- Complete incomplete COSMIC cells in `docs/spec/reference-outcomes.md` from
  pinned source; retain explicit TBD for unsupported native/live outcomes.
- Pin: cosmic-comp `3d55cba06c9cf6f27609cdefb520f7857dba20af`, matching the
  existing matrix. Local clone is clean.
- Preserve all other WM cells, KDE/Windows cells, selected variants and product
  behavior. No live testing; never stage the user-owned `devenv.nix`.

## Acceptance and approach

- Sequential bounded units: insertion/workspace/removal;
  floating/maximize/startup/minimums; groups/drag/owner controls.
- Edit only the matrix and its evidence register. Cite pinned file:line
  source, qualify unsupported fixture outcomes, and report discrepancies with
  current KDE/Windows behavior. New minimal rows only for uncovered ambiguities.
- Review diffs and source evidence, reconcile coverage/counts, verify
  unchanged protected cells and `git diff --check`, then archive this note.
- Publish only intended files on main after status/diff/log inspection.

## Outcome

- Completed sequential implementation units and an independent evidence review.
- 43 COSMIC cells updated: 37 have source-proven policy evidence; six clarify
  owner-specific applicability (R-CTL-01/02/03/05/06/07). Across all 58 rows,
  35 retain explicit partial/fixture/native TBD; no bare COSMIC TBD remains.
- No rows added. Protected Start/Action/Observe, other WM and KDE/Windows cells,
  variants, and all seven UT tags match the original matrix. Citation keys
  resolve; `git diff --check` passes. No product decisions changed.
- Additional read-only clones needed for Alt+Tab: cosmic-launcher
  `49d11203116c43419d2b64844ac5c457124a8571` and launcher
  `6390080a98a4a59b4e8196d28de97d3cb4d138ec` (launcher dependency lock pin).
  cosmic-settings-daemon evidence uses the existing Cargo checkout at
  `e37160f14d1e7ee428f973cd2848b4e95f83dfe1` (cosmic-comp lock pin).
- Review corrected an initially unsupported no-raise-on-focus assumption:
  `S-cos-raise` proves floating focus raises, determining startup admission
  order. Review also added restore-state save/remap evidence and distinguished
  focused-window stacking from focused-group stacking. No unresolved findings.
- Key decision inputs: sticky-off uses the active workspace, fullscreen reflows
  siblings, workspace re-enable absorbs intentional floats, centre drops stack,
  Escape resolves a normal drop, and drag press focuses the mover. Detailed
  source policy and remaining native qualifications are in the matrix.
- Remaining user action: decide desired parity for these differences, then
  live-test the explicitly unsupported native/visual journeys when authorized.
