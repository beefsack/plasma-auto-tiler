# 0.1 release scope and open-decision outcomes

## Goal and scope

Record the user's 2026-10-10 approved KDE 0.1, Windows release, shortcut,
and research outcomes in the current governance records. Documentation only.
Do not classify pending live checks or triage OPEN requirements in this piece.

## Acceptance

- Current rules appear in their behaviour areas in `docs/decisions.md`.
- Functional-spec shortcut bindings match Meta+Y / Win+Y for workspace tiling.
- Backlog retains Windows handoff items 1-20, adds the binding after 20,
  reflects release gates and ordering, and removes resolved open decisions.
- Research lessons, reports, and evidence stay linked from their target items.
- Packaging acceptance records uninstall guidance and effect-absent resilience.
- Relative documentation links are valid; superseded rules are removed.
- Archive this note; documentation files only, rebasing before publication.

## Approach and bounded units

1. Investigate current records and propose exact edits;
   integrate the governance changes.
2. Verify the diff against each user decision and check documentation links.
3. Record accepted evidence and archive.

## Verification and outcome

- Initial worktree was clean; `git pull --rebase` reported already up to date.
- Records investigated and changes proposed; governance updates integrated.
  An independent review checked the actual diff against every decision, relative links and anchors,
  remaining open entries, and preserved Windows handoff structure.
- Accepted evidence: all requested decisions recorded in their behaviour
  areas; shortcut row marks the new defaults as selected, binding implementation
  pending; six open-decision entries remain. Backlog: 3001 -> 3077 lines.
  No OPEN triage or pending-live-check classification performed.
- Review corrections: remove stale parked multi-output references, keep new
  P0 presentation research and P1 packaging in their priority areas, and
  persist the conditional KDE borderless-game watch rule.
- Existing-record conflict: the Windows session selected prefixed on-window
  markers for item 8 (`91db9d2`) before proposal-first
  decision 2 was recorded. User 2026-10-10 chose option A: the Windows-session
  marker selection stands and decision 2 is withdrawn as already satisfied;
  item 8 is unblocked.
- Report section links and archived non-native evidence are retained from
  KDE, Windows gate/measurement/presentation and macOS Phase 0 target items.
  `git diff --check` passed; changes are documentation only.
- Records complete and note archived for publication; the four documentation files only.
- Next, the user creates OBS account/project,
  GitHub-to-OBS token and AUR account. Check classification and OPEN triage
  remain separate follow-up pieces.
