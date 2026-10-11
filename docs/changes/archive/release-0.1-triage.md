# 0.1 OPEN-requirement and live-check triage proposal

## Goal and scope

- Propose, without deciding product behavior, KDE 0.1 triage of all 60 OPEN
  requirements plus the REQ-MAX-09 KDE fullscreen-send observe-first sub-leg.
- Classify every pending live-check entry against the approved release gate;
  identify missing gate coverage and propose concise checks.
- Deliver `docs/research/release-0.1-triage.md` and a proposal link in the
  backlog release item. No live testing, source changes or principles edits.

## Acceptance

- Complete, unique OPEN-row coverage; impact-ordered grouped decision briefs
  with cited current KDE behavior, COSMIC-first reference tallies, options,
  consequences and product-rule-aligned recommendations.
- Complete pending-live-check coverage with must-pass, known-issue-allowed
  or Windows-release labels and reasons; explicit coverage gaps and new checks.
- Independent spot-checks of classifications and verification of every
  recommendation's reference tally. Resolve findings before publication.
- Documentation links and diff checks pass.

## Approach and bounded units

1. Investigate evidence and draft the research proposal.
2. Inspect the result and link the proposal from the release item.
3. Independently check tallies, sampled triage,
   coverage, live-check gate mapping and links; integrate corrections.
4. Record evidence, archive this note and verify.

## Evidence

- Root guidance read; initial `git pull --rebase` already up to date.
- Initial worktree clean at `4281e73`; approved scope/gate verified in
  `docs/decisions.md` and the backlog release item.

## Verification and outcome

- The proposal drafted; every recommendation's reference tally, sampled
  classifications against records/source, all row coverage and local links
  independently checked. Final independent acceptance passed.
- Accepted coverage: 60 unique OPEN rows, 32 relevant and 28 post-0.1;
  separate relevant MAX-09 leg. There are 28 decision units (27 covering
  OPEN rows plus MAX-09), including four genuinely grouped units.
- All 53 pending live-check entries classified: 39 must-pass, 12
  known-issue-allowed, two Windows-release. Four additional check proposals
  cover effect-absent legs, external config reconciliation, sleep with a
  game present, and scaling with overlays; existing gate coverage is linked.
- Review corrections included the reversed minimize-allocation interpretation,
  move voter lists, activation tally, stale restart consensus label,
  settings-rule exemptions, oversized grouping, live-count arithmetic and
  a broken OPEN-index anchor. Later review rejected unsupported model-only
  exclusions for leaf swaps; those shared alternatives are now settings.
- Observed COSMIC behavior is distinguished from source votes; thin evidence
  and unresolved native journeys remain explicit. MAX-09 retains observe-first
  and asks for approval to ship the current refusal as a listed issue.
- Backlog release item links the proposal as awaiting user decisions. No
  product choices promoted to decisions; no live tests or source changes.
- Final documentation checks precede publication.
- Exact next action: user decides D01 fullscreen admission/close cleanup in
  the proposal's impact-ordered summary, then the remaining units.
