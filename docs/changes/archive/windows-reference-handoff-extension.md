# Windows reference handoff extension

## Goal and scope

- Extend the Windows reference-consensus handoff in `docs/backlog.md` for Q1.
- Document accepted resize, press activation, restart floats, fullscreen send,
  float-origin focus/half-snaps, maximized-floating retile, and workspace-mode
  parity using verified source locations.
- Correct current-code facts in the reference-outcome Windows matrix cells and
  reconcile the handoff's source-discrepancy table.
- Docs only; no product decisions, code changes, live testing, or installs.

## Acceptance and approach

- Preserve the handoff structure and explain the extended implementation order.
- Each new entry covers behavior, source seams, input/settings/presets, tests,
  user-owned live acceptance, and definition of done.
- Cite governing rows for outcomes not decided; escalate conflicts rather than
  selecting behavior. Reserve Q2-Q5 entries for their owning KDE pieces.
- Verify citations against source and inspect the final diff personally.
- Check whitespace, added-text ASCII, links,
  and spec totals/indexes if the functional spec changes.

## Bounded units

1. Investigate governing rows, source discrepancies, and exact seams.
2. Extend handoff and correct verified matrix facts from accepted evidence.
3. Review source/diff, reconcile findings, run gates, and stage documents.
4. Independent audit of source claims and unresolved decision boundaries.

## Constraints and decisions

- Root guidance and both live-testing guides read. No live tests authorized.
- This handoff edit only; no other backlog maintenance is in scope.

## Evidence and outcome

- Initial working tree clean.
- Delivered seven handoff entries (6-12), dependency rationales, current-revision
  provenance, and the Q2-Q5 reservation. Existing item 1-5 checklists preserved.
- Corrected Windows R-OUT-01/R-MOV-05 crossing claims and R-WS-10/R-WS-16
  removal-path claims; reconciled REQ-WS-10 without changing its OPEN status.
- Inspected the diff and source for resize dispatch, drag press/drop,
  float/sticky markers, workspace cleanup, fullscreen-send refusals and Q3
  retained-overlay projection. Independent source audit accepted after
  correcting distance/tie wording, test paths and control references.
- Removed unsupported journal-based float persistence and post-restart un-stick
  outcomes from the draft. Persistence mechanism, restart membership/focus,
  resize preset policy and scope-configuration exposure remain explicitly
  unselected; no decision is needed to complete this documentation change.
- Recorded stale KDE R-MAX-03 delivery status in `docs/decisions.md:571` with
  the superseding `29c75fe` archive evidence; behavior selection is unchanged.
- Verification: whitespace and added-text ASCII, added relative links,
  functional-spec totals/status indexes, and docs-only scope checks.
- No live tests or dependency installations. Exact next action: review
  and publish the staged Q1 documents; Windows implementation and
  user-owned native acceptance remain queued in the handoff.
