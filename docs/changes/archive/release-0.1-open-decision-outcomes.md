# 0.1 release scope and open-decision outcomes

## Goal and scope

Record the user's 2026-10-10 approved KDE 0.1, Windows release, shortcut,
and research outcomes in the current governance records. Documentation only.
Do not classify pending live checks or triage OPEN requirements in this piece.
Do not edit `docs/principles.md` or disturb concurrent Windows work or stashes.

## Acceptance

- Current rules appear in their behaviour areas in `docs/decisions.md`.
- Functional-spec shortcut bindings match Meta+Y / Win+Y for workspace tiling.
- Backlog retains Windows handoff items 1-20, adds the binding after 20,
  reflects release gates and ordering, and removes resolved open decisions.
- Research lessons, reports, and evidence stay linked from their target items.
- Packaging acceptance records uninstall guidance and effect-absent resilience.
- Relative documentation links are valid; superseded rules are removed.
- Archive this note, then commit and push only the owned documentation files,
  pulling with rebase before committing and before pushing.

## Approach and bounded units

1. One muse-spark Worker investigates current records and proposes exact edits;
   the Lead integrates the governance changes and owns the backlog.
2. Verify the diff against each user decision and check documentation links.
3. Record accepted evidence, archive, synchronize, commit, and push.

## Verification and outcome

- Initial worktree was clean; `git pull --rebase` reported already up to date.
- One muse-spark Worker investigated records and proposed changes; the Lead
  integrated the governance updates. A fresh independent muse-spark Worker
  reviewed the actual diff against every decision, relative links and anchors,
  remaining open entries, and preserved Windows handoff structure.
- Accepted evidence: all requested decisions recorded in their behaviour
  areas; shortcut row marks the new defaults as selected, binding implementation
  pending; six open-decision entries remain. Backlog: 3001 -> 3077 lines.
  No OPEN triage or pending-live-check classification performed.
- Review corrections: remove stale parked multi-output references, keep new
  P0 presentation research and P1 packaging in their priority areas, and
  persist the conditional KDE borderless-game watch rule.
- Existing-record conflict reconciled: item 8's summary selected prefixed
  on-window markers (`91db9d2`) while its detail said mechanism unselected.
  The user's latest proposal-first instruction supersedes that summary;
  implementation remains blocked pending the user's design decision.
- Report section links and archived non-native evidence are retained from
  KDE, Windows gate/measurement/presentation and macOS Phase 0 target items.
  `git diff --check` passed; changes are documentation only.
- Records complete and note archived for publication. Synchronize immediately
  before commit and push; stage only the four owned documentation files.
- Next orchestrator session starts with the user creating OBS account/project,
  GitHub-to-OBS token and AUR account. Check classification and OPEN triage
  remain separate follow-up pieces.
