# Log: Split `kwin/tests/controller.test.ts`

Append-only. Append after a meaningful checkpoint: an accepted semantic unit,
verified partial result, blocker, pending user decision, unsuccessful host
attempt, context handover, semantic or governance change, independent review
finding, commit, or approved plan change. Each entry records timestamp, role
and work unit and attempt, result, changed files or commit, verification, and
any discovery, blocker, or required decision. No narration, copied output, or
speculation.

## 2026-08-20 (session start)

- Role / unit: Lead / investigation and specification (no work unit yet)
- Result: `spec.md` and `plan.md` produced and self-approved under
  autonomous mode (dispatch brief explicitly authorized creating these
  files); no implementation performed - hard constraint for this session
  forbade spawning subagents and moving any test code.
- Files / commit: `docs/changes/controller-test-split/{spec.md,plan.md,log.md}`
  created (untracked, not staged).
- Verification: baseline `npm test` run live at HEAD `ecbf5ef` inside
  `kwin/` confirmed `tests 838`, `suites 78`, `pass 838`, `fail 0`;
  `grep -c "describe(" kwin/tests/*.test.ts` totals 78, confirming no
  nested `describe`s exist anywhere in the suite. No module-level mutable
  state found in `controller.test.ts`'s preamble (`grep -n "^let \|^var
  \|static "` over lines 1-1015 returns nothing).
- Notes: 40 top-level `describe`s enumerated with exact line ranges (see
  `spec.md` Target File Set); grouped into 20 target files + 1 shared
  fixture module (`controller-fixtures.ts`). Three files (interactive drag,
  automatic dwindle ownership, dynamic virtual desktops) remain over the
  1,000-line threshold because each is a single oversized `describe` that
  cannot be split without adding new suite boundaries - disclosed as
  accepted in `spec.md`, not resolved. No pending user decision recorded.
  Next action: dispatch unit-01 (create `controller-fixtures.ts`) in a
  future session/Lead stint.
