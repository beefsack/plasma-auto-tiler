# Reference matrix GWT migration

- Status: active; 13 of 58 historical scenarios migrated and verified.
- Baseline: `e160894`; date: 2026-10-07.
- Goal: one GWT format across all 125 matrix scenarios, with 14 separate
  profile outcomes including Ours KDE and Ours Windows.
- Scope: historical wide tables, their scrolling assessments, current-format
  index/area notes and any broken anchor links. Preserve IDs, fixtures,
  actions, observations, outcomes, evidence tags/citations and variant hooks.
- Non-goals: outcome research, behavior changes, historical status recensus,
  live tests, principles/decisions/backlog edits or dependency changes.
- Approach: sequential bounded Workers; commit/push each small area group,
  pulling with rebase before every push; archive this record at completion.
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
| floating.md | 11 | Pending |
| maximize-fullscreen.md | 7 | Pending |
| workspaces.md | 7 | Pending |
| multi-output.md | 2 | Pending |
| mouse.md | 8 | Pending |
| restart-persistence.md | 10 | Pending |

## Ours splits

- R-MIN-01..03: explicit KDE write-skip vs Windows origin/minimum behavior
  split; shared qualifications and citations retained in both bullets.
- Other first-group cells: shared text duplicated verbatim.
- Unclear splits flagged: none so far. Any unclear original cell will be
  retained under both platform bullets and listed here without inference.

## Accepted evidence

- First group: offline baseline comparisons passed for all 13 historical
  scenarios, unchanged new/explicit-swap blocks, scenario inventory and
  citation-key multisets; 14-profile counts, ASCII and whitespace passed.
- Independent Worker reviewed insertion, nested move/explicit swaps, close
  and all minimum-size platform splits: no lost-content finding.
- Initial implementation omitted column Given/When/Observe framing; restored
  every original bullet before acceptance and strengthened verification.
- `git diff --check` passed. Full repository anchor/link audit and index
  format cleanup follow the remaining area migrations.

## Next action

- Migrate floating/maximize, workspace/output, then mouse/startup/control
  groups; verify each group, update the index, audit links and archive.
