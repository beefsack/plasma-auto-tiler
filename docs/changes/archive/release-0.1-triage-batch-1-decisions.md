# Release 0.1 triage batch 1 decisions

## Goal and acceptance

- Record User 2026-10-10 approval of recommendation (a) for D02, D04-D08,
  D11, D14, D15, D17-D21 and D24 in the triage report at `27a97c4`.
- Promote exactly 16 requirement rows: 105/60/0 becomes 121/44/0
  NORMATIVE/OPEN/PROVISIONAL; reconcile current decisions, triage and backlog.
- Preserve pending decisions, Proposal B approval, native unknowns, existing stashes
  and `docs/principles.md`. Documentation only; no live testing.

## Approach and bounded units

1. Read-only investigation of selected behaviors and current code.
2. Record rules, implementation/verification work and pending live checks.
3. Fresh independent consistency check of the four durable records.
4. Inspect intended diff.

## Accepted investigation and material decisions

- Shared admission with focused float currently root-wraps (`world.rs`
  `focus_resolves`, `session.rs` `insert_tiled`); D05 requires a tiling-neighbor
  anchor instead. R-INS-05's anchor is B, the prior tiled focus.
- D06 observes the newcomer's native output, not a focused-output override;
  D17 KDE return is shell-driven. Both need observe-first evidence, with
  implementation contingent on a mismatch. Windows remembers return focus.
- Other 12 units have current mechanisms/defaults matching the selected rule;
  exact live/native legs remain unverified. D07 additionally needs a proving
  fresh-reopen fixture. D14 Windows trigger gap is already handoff item 6;
  no new Windows-specific implementation handoff is justified.
- D18 has no setting; D20 has no lower verb for now. New-settings timing is
  an open meta-question to raise with D03, not an approved defaults-only policy.
- Proposal B's 39/12/2 and N1-N4 remain unapproved; added batch-1 checks receive
  no release-gate classification here.

## Verification and outcome

- Fresh independent review PASS: exactly the approved 16 rows
  promoted, 121/44/0 totals, 44 OPEN IDs agree with the index (existing in-row
  MAX-09 fullscreen note retained), 15 concise current rules, matching backlog
  and triage approvals/pending units. Links and `git diff --check` pass.
- The four-file diff inspected; no product implementation, live tests,
  new settings approval or Proposal B classification is implied. No findings,
  semantic failed approaches or unresolved documentation acceptance gaps.
- Added the P1 batch-1 KDE/shared item and one grouped user-owned native-check
  entry. Existing Windows handoff item 6 covers resize; no new handoff number.
- Documentation outcome complete. Next product action: D05 shared/KDE
  admission repair; D06/D17 need user-owned observe-first checks. Next user
  decision queue retains D01, then D28/D03 in the report order; raise the
  settings-timing meta-question with D03.
