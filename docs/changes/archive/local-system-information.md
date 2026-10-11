# Remove local-system information

## Goal and acceptance

- Apply the user rule approved 2026-10-11: tracked repository content contains
  no local evidence paths, personal checkout paths, machine identity, or
  hardware/resource details.
- Preserve substantive evidence, versions, relevant display/test conditions,
  public repository URLs, and functional product or generic temporary paths.
- Identify pinned reference-WM sources by upstream repository and commit.
- Add the concise future rule to `AGENTS.md`.

## Scope and approach

- Sweep all tracked text, including documentation archives, source comments,
  scripts, packaging, and CI. No behavior changes or history rewriting.
- Content sanitized; backlog reconciled and the
  durable rule recorded. The broad cleanup independently reviewed.
- Verify with a final tracked-text search and `git diff --check`; explain
  any remaining path or machine-related search hits by their functional role.

## Outcome

- Completed: 119 existing Markdown files sanitized, including 85 archive
  records; this archived note makes 120 files in the cleanup commit.
- Added the exact rule to `AGENTS.md` and its dated user decision to
  `docs/decisions.md`. Updated backlog links for generalized check headings.
- Reference-WM citations retain upstream repositories and original pins.
  Evidence retains results, versions, checksums and relevant display conditions;
  concrete checkout, runtime, temporary-artifact and Nix-store paths are dropped.
- Review corrected replacement-induced acronym/citation formatting and restored
  single-output versus multi-output distinctions. No unresolved findings.
- Final tracked-text sweep: 44 justified matches in 16 files. Remaining paths
  belong to executable temporary-log recipes, security/containment fixtures,
  and synthetic home-directory tests. Two RAM references are published Microsoft
  Dev Drive/Sandbox prerequisites, not measurements of a local machine.
- Extended sweep found no personal checkout or artifact paths, local usernames
  in paths, concrete user-runtime or Nix-store paths, hostnames, or machine-form
  identity references. `git diff --check` passed. Public repository URLs remain.
- Next action: none for repository-content cleanup; publication CI is checked
  and reported in the delivery handover.
