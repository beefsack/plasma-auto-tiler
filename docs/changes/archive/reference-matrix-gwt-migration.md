# Reference matrix GWT migration

- Status: complete and archived; all 58 historical scenarios migrated,
  index updated and final preservation/link audit passed.
- Baseline: `e160894`; date: 2026-10-07.
- Goal: one GWT format across all 125 matrix scenarios, with 14 separate
  profile outcomes including Ours KDE and Ours Windows.
- Scope: historical wide tables, their scrolling assessments, current-format
  index/area notes and any broken anchor links. Preserve IDs, fixtures,
  actions, observations, outcomes, evidence tags/citations and variant hooks.
- Non-goals: outcome research, behavior changes, historical status recensus,
  live tests, principles/decisions/backlog edits or dependency changes.
- Approach: sequential bounded Workers; Lead reviewed and integrated each
  group, committed/pushed after rebase, and archived this record at completion.
- Acceptance: unchanged per-file scenario inventory; 14 Then bullets per
  scenario; exact outcome/fixture retention and citation-key multisets with
  explicit accounting for shared Ours citations duplicated into two bullets;
  resolved local links, stable anchors/IDs, ASCII and clean whitespace.

## Per-file status

| File under docs/spec/reference-outcomes/ | Historical scenarios | Status |
|---|---:|---|
| insertion.md | 2 | Verified |
| move.md | 5 | Verified |
| groups-stacks.md | 1 | Verified |
| close.md | 2 | Verified |
| minimum-size.md | 3 | Verified |
| floating.md | 11 | Verified |
| maximize-fullscreen.md | 7 | Verified |
| workspaces.md | 7 | Verified |
| multi-output.md | 2 | Verified |
| mouse.md | 8 | Verified |
| restart-persistence.md | 10 | Verified |

## Ours splits

- R-MIN-01..03: explicit KDE write-skip vs Windows origin/minimum behavior
  split; shared qualifications and citations retained in both bullets.
- Other first-group cells: shared text duplicated verbatim.
- Floating/overlay group: 12 clear platform splits; other cells shared and
  duplicated, except the unclear cell below. Citations attached to an explicit
  platform remain scoped; shared citations are duplicated.
- Unclear split: R-MAX-01, Windows "same" could inherit slot/share only or the
  full KDE no-writes/exact-restore clause. Original combined text retained
  verbatim in both platform bullets, with all original citations.
- Workspace/output group: R-WS-03/06/07 explicitly split by platform; other
  cells shared and duplicated. No additional unclear splits.
- Mouse/startup/control group: R-DRAG-03..08, R-START-03 and R-CTL-01/03/04
  explicitly split. R-DRAG-01/02 and R-START-01/02 shared and duplicated.
- Unclear split: R-CTL-02, "other platforms TBD" does not explicitly identify
  KDE's outcome. Original combined text retained under both platforms.
- Unclear splits: R-CTL-05/06/07, KDE-specific fixtures/evidence without an
  explicit Windows outcome. Original text retained under both platforms;
  this supplies no new Windows applicability or outcome claim.

## Accepted evidence

- First group: offline baseline comparisons passed for all 13 historical
  scenarios, unchanged new/explicit-swap blocks, scenario inventory and
  citation-key multisets; 14-profile counts, ASCII and whitespace passed.
- Independent Worker reviewed insertion, nested move/explicit swaps, close
  and all minimum-size platform splits: no lost-content finding.
- Initial implementation omitted column Given/When/Observe framing; restored
  every original bullet before acceptance and strengthened verification.
- `git diff --check` passed for every area group and closeout.
- Floating/overlay group: 18 scenarios verified against the baseline;
  tree/scrolling cells and framing retained, new scenarios unchanged,
  per-scenario and whole-file citation multisets matched precise shared-key
  duplication allowances; 14 Thens, ID counts, ASCII and whitespace passed.
- Lead rejected narrowing R-MAX-01's "same" scope; original text restored in
  both bullets before acceptance, with ambiguity retained above.
- Workspace/output group: nine historical scenarios verified, inventories
  remain 14/6 scenarios. Full-file/scenario citation multisets, exact original
  reference/scrolling cells and framing, unchanged new blocks, 14 profiles,
  retained links, ASCII and whitespace passed. Locator-only references to
  wide rows/backfills now name the tree/column leg.
- Mouse/startup/control group: 18 historical scenarios verified; new mouse
  and restart blocks/inventories unchanged. Reference/scrolling cells and
  complete framing, scenario and file citation multisets, 14-profile counts,
  ID counts, local links, ASCII and whitespace passed. R-START-03's shared
  placement citation appears in both platform bullets; platform-only keys
  remain scoped. Wide-row locators now name the scenario.

## Final outcome

- 58 historical scenarios migrated in 11 area files; zero wide-table rows
  remain. All 125 scenario IDs and per-file counts unchanged, each with
  exactly 14 canonical Then bullets: 1750 total, plus 28 explicit-swap Thens.
- All 67 expansion scenarios and two explicit-swap legs preserved verbatim
  after ignoring legacy-anchor alias lines. Index notation, profiles,
  legend, hooks and citation multisets unchanged; current-format notes updated.
- 70 HTML aliases preserve every removed heading anchor, including the
  duplicate scrolling-section suffix. All baseline area heading slugs resolve.
  Incoming links from docs/ and AGENTS.md and matrix/index outbound Markdown
  targets/fragments resolve; no consensus link repair was needed.
- Full-file and per-scenario citation-key multisets matched baseline plus
  precisely 40 shared Ours citation occurrences duplicated into the separate
  platform bullets: 3 source and 37 documentation occurrences, zero UT extras.
  No citation keys were added or removed.
- Integrated offline verifier passed: `python3
  verify_matrix_gwt.py --quiet`; checks include every scenario's
  actual 14-profile count, exact reference/scrolling cells and fixtures,
  unchanged new blocks, citation multisets, anchors, links, ASCII and whitespace.
- Independent Worker reviewed first-group and final cross-area diff samples:
  no lost-content finding. The framing omission and narrowed "same" wording
  described above were corrected before acceptance; no unresolved preservation
  issue remains. The five unclear Ours IDs retain their original wording.
- Area commits pushed: `c365fca` (13), `404015f` (18), `7aabecc` (9),
  `070eb95` (18). All area CI runs passed; closeout CI checked after push.
- No live testing, outcome research, product behavior or dependency changes.

## Next action

- None for the migration. The flagged Ours platform scopes remain available
  for later clarification without blocking this content-preserving format.
