# Windows port research

- Goal: decision-ready Windows port plan and separate cross-platform extraction analysis.
- Scope: research, source audit, documentation only; no product code, host mutation or dependencies.
- Acceptance: `docs/research/windows-port/plan.md` covers requested decisions, verified/observed/inferred evidence, risks, phased spikes and user choices; `docs/research/cross-platform-core/extraction.md` cites actual code locations and migration boundaries. Review Markdown, source links and diff.
- Approach: sequential, fresh bounded units for Windows runtime/input, workspaces/tiler precedents, UI/distribution, and local code audit; integrate and check claims against source.
- Outcome: wrote `docs/research/windows-port/plan.md` and `docs/research/cross-platform-core/extraction.md`; recommendations are not approved product decisions, so `docs/decisions.md` is unchanged.
- Evidence: Windows primary API and upstream license references checked 2026-09-29; repository code read without live tests. `git diff --no-index --check /dev/null` found no whitespace errors for both deliverables; ASCII searches found no non-ASCII characters; `git status --short` confirms existing `devenv.nix` modification remains untouched. Two broken upstream document URLs found during review were replaced with current sources.
