# macOS port research

- Goal: decision-ready macOS plan comparable with the Windows plan, plus a
  three-host portable-core comparison.
- Scope: research and documentation only; no product code, dependencies, live
  desktop mutation or approved product decision. Preserve the user's
  `devenv.nix` edit.
- Acceptance: cover development, process, AX/TCC, input, Spaces/managed
  workspaces, visuals, UI, licensing and distribution; cite V/O/I evidence,
  recommend architecture/spikes, expose user decisions and risks. Compare
  KWin/Windows/macOS capability and sharing boundaries in the extraction audit.
- Approach: four sequential, fresh, bounded macOS API, visuals/upstream,
  delivery/runtime and local-core units returned cited findings; plans
  reconciled and portable boundaries source-audited.
- Outcome: added `docs/research/macos-port/plan.md`, updated
  `docs/research/cross-platform-core/extraction.md` and cross-linked
  `docs/research/windows-port/plan.md`. Proposed choices remain unapproved;
  `docs/decisions.md` is unchanged.
- Evidence: vendor docs, upstream source and licenses date-checked
  2026-09-29; local core/adapter source locations inspected. No macOS host
  test or parity claim. `git diff --check` and `git diff --no-index --check`
  on each new file found no whitespace errors; ASCII scans found no non-ASCII
  text. `git status --short` shows only the three research deliverables and
  this record alongside the pre-existing untouched `devenv.nix` edit.
