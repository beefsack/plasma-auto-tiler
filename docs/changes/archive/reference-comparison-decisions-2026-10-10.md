# Reference comparison decisions 2026-10-10

## Goal and scope

- Record the user's G-01 through G-07, G-37, and G-D2 decisions from the reference comparison review in current governance records.
- Documentation only; queue implementation and live checks. Preserve `docs/principles.md`, the three git stashes, and the review's analysis.

## Acceptance

- Decisions, requirement rows, backlog, and review agree on approved behaviour, deliberate COSMIC deviations, and implementation gaps.
- REQ-MAX-08 is NORMATIVE; spec totals match the requirement rows.
- Backlog has the consolidated P1 implementation item, Windows handoff additions after item 16, pending live checks, and pinned/persistent workspaces Future item; decided open questions are removed.
- An independent review of consistency before the documentation-only publication.

## Approach and bounded units

1. Investigate affected records and propose precise edits and any conflicts.
2. Integrate governance edits, including the backlog changes.
3. Fresh independent review of the diff; check requirement totals and cross-record consistency.
4. Resolve findings, archive this note, verify the intended staged diff and publish.

## Verification

- Inspect actual diff and repository status; check requirement-status totals, links, and stale contradictory policy text.
- No live desktop testing or code changes in this piece.

## Material decisions and evidence

- Updated `docs/backlog.md` in this documentation change.
- Initial tree is clean at `3431275`; three existing stashes are present and must remain untouched.
- Integrated all approved rules in place by behaviour area; G-05/G-06/G-37 and G-D2 KDE carry remain implementation gaps, not code delivery.
- Spec totals verified before/after: 104 NORMATIVE / 61 OPEN / 0 PROVISIONAL -> 105 / 60 / 0 (165 requirement rows); only REQ-MAX-08 changes status.
- Backlog now has P1 `Reference comparison decisions 2026-10-10`, Windows handoff items 17-20, the pinned/persistent workspaces Future item, and pending live checks. The decided comparison/navigation questions are removed.
- Minimal existing-scenario variants in the matrix index discriminate an isolated maximized mover and migration MRU/default/fallback; unsupported reference/native outcomes remain TBD.
- Independent consistency review passed: selections, totals, local links, docs-only scope, unchanged 35 NOT MATERIAL groups, and separate KDE fullscreen observe-first policy checked. Its low-severity D4/D5 source-citation nit was corrected without changing behaviour.
- No policy conflicts found. G-37 cites REQ-WS-12d in the request; the existing source rule is REQ-WS-12e/D5, so both rows cross-reference the setting. Exact MRU eligibility remains implementation work using item-1.2 per-output history and last-remaining fallback.
- Consensus report left unchanged: its maximize audit is historical; pre-existing stale B9 retained-maximize/provisional wording at `docs/research/reference-wm-consensus.md:48-52` is flagged for the user's handover.
- Verification: `git diff --check` passed; independent requirement counts and link checks passed. No live desktop tests were run. Implementation next starts with G-05 in the consolidated P1 item.
