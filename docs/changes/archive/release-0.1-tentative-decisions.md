# Release 0.1 tentative decisions

- Goal: record the remaining 13 triage units, settings scope and Proposal B as
  tentative decisions dated 2026-10-11, pending user review.
- Scope: triage report, functional spec, current-rule decision pointers and
  backlog, including source-inspected KDE/shared implementation gaps. Docs only;
  no behavior changes or live testing.
- Acceptance: affected spec rows PROVISIONAL, never NORMATIVE; exact counts and
  indexes reconciled; defaults-only 0.1 with P2 settings follow-up; P1 gap table
  and Windows handoff boundary; tentative M39/K12/W2 and N1-N4 action/oracle queue.
- Approach: inspect KDE/shared code, then bounded docs reconciliation, backlog
  integration and evidence review.
- Verification: repository docs/link checks if available, requirement/index
  counts, changed local links and git whitespace check; CI after publication.
- Material findings: admission has overlay geometry guards but no fullscreen
  focus fence; ordinary float sends are tiled-only; minimize omission has no
  stored old-slot restoration; activation/urgency routing is absent. Existing
  generic observation/rebuild serves D25. D26 cross-login intent is incompatible
  with the approved session-scoped namespace, so disclose tentative fallback
  (b), without changing that lifetime. Gap inspection revision: `fafcd31`.
- Accepted outcome: 13 units, defaults-only/settings P2 and Proposal B recorded
  as tentative pending user review. Spec 121 NORMATIVE / 17 PROVISIONAL / 28 OPEN
  (166 rows); 16 OPEN rows moved and KDE D28 split from NORMATIVE REQ-MAX-09.
  Backlog has the P1 per-unit implementation assessment, P2 settings follow-up,
  Windows handoff item 22, N1-N4 action/expected-result queue and listed D26/D28
  tentative limitations. Four minimal discriminators retain native outcomes TBD.
- Accepted evidence: serial source investigation, independent
  uncertain-path review and final independent docs review. Counts/indexes and
  changed local link targets/anchors pass; `git diff --check` passes. No dedicated
  docs/link recipe exists in justfile or CI. No behavior or live tests changed.
- Publication: exact-commit CI check after publication.
- Next action: user review of tentative decisions, especially D26 fallback;
  approved code units then proceed through KDE/shared work and Windows handoff.
