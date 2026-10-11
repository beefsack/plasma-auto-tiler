# Windows dogfood nested group underlay geometry

## Goal and acceptance

- Diagnose the reported short underlay in `V[W1 H[W2 W3]]` with W2 focused,
  using the supplied trace and Windows/core visual geometry source.
- Check DPI, stale group geometry, immediate-parent selection and work-area
  offsets without assuming a cause. Fix a demonstrated defect with regression
  coverage; add bounded geometry observability if the trace lacks necessary data.

## Scope and plan

- Windows adapter changes preferred; no concurrent KDE/core edits unless needed.
- Worker investigates and implements one bounded geometry fix; Lead reviews,
  runs gates, updates the existing group-underlay archive and publishes this note.
- No live tests, windows/hooks/input/harness launches or dependency installs.

## Verification

- Offline nested-layout geometry regression, native four-crate gates with the
  eight audited live tests skipped, post-push CI.
- User live check pending: focused W2, hold Win+Shift before a move in the
  reported nested layout; inspect full immediate-parent coverage and trace.

## Outcome and evidence (2026-10-11)

- Offline-delivered; native appearance check pending. The normal window plan
  honors minimum-size hints, but `ActiveGroup` projected the same tree without
  hints. The focused subtree therefore began partway down its displayed member.
  Tick 136 in the supplied `7f407ca` trace is reproduced exactly offline: one
  retained-share fixture yields both the logged hint-enforced window plan and
  the logged short hint-free underlay. The top-edge deficit equals the focused
  member's unmet minimum in the raw projection.
- DPI/padding and work-area origin are not the cause in that replay. The
  immediate-parent members are correct; no stale revision is required. A second
  fixture reproduces the same failure for `V[W1 H[W2 W3]]`.
- Minimal shared correction is necessary: `describe_active_group_with_hints`
  uses the ordinary hint-aware projector, and `resolve_active_group` consumes
  advisory hints from query entries. Existing hintless API and wire shapes are
  preserved. Windows carries the retained per-member hints used by its plan;
  query entries contain no native/client geometry and trigger no convergence.
  Infeasible minimums retain the ordinary proportional fallback. No new native
  queries, foreign-window writes or changed underlay triggers.
- Production resolver regressions compare a committed Session's ordinary plan
  and group union for the trace fixture and the nested H subgroup. Both fail on
  the old resolver and pass after the fix. Legacy hintless behavior, hint-only
  transport and numeric/opaque diagnostics are covered. Independent review found
  no blockers. Initial diagnostics-only investigation was superseded by the
  exact minimum-hint replay; no speculative geometry fix was accepted.
- Existing `group-underlay` events now include union, group/leaf ids, member
  tokens/rectangles, DPI, physical padding inputs and domain/revision. These
  fields disambiguate any recurrence without logging window titles or content.
- Native four-crate locked offline build/test/fmt/clippy (`-D warnings`) and
  whitespace gates pass; the same eight window-creating tests listed in
  [item (a)](windows-first-run-stop.md) were skipped. No live actions ran.
  Shared Linux/KDE compatibility is checked through post-push CI.
- User live check: create `V[W1 H[W2 W3]]`, focus W2, hold Win+Shift before a
  move. The underlay must cover the whole H subgroup plus configured padding,
  including W2's top edge, before and during movement. Release the chord and
  verify it hides. Supply a trace if coverage is still short; new fields let us
  compare union/member rectangles with the ordinary plan. End with graceful stop.
