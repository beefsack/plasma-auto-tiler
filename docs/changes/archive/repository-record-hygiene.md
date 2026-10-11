# Repository record hygiene and canonical links

## Goal and scope

- Keep durable records focused on work, evidence and product decisions across
  tracked documentation, archives, comments and packaging metadata.
- Use `beefsack/OmniTiler` for GitHub references; preserve lowercase package,
  binary and identifier names.
- Record `omnitiler.com` as the project's registered future home page and
  reverse-DNS basis, retaining GitHub package homepages until the site is live.
- Preserve substantive results, dates, decision status and live-testing policy.
  No product behavior or dependency changes.

## Acceptance and approach

- Add the concise repository-record policy to root `AGENTS.md`.
- Sweep all tracked text, preserve factual evidence and tentative decisions
  pending user review, and repair links affected by heading changes.
- Canonicalize repository references in docs, packaging and script guards.
- Review the diff, classify remaining keyword matches, verify anchors and
  packaging URL consistency, and run `git diff --check`.

## Verification and outcome

- Completed 2026-10-11: root policy added, tracked records cleaned, canonical
  GitHub references updated and registered-domain decision recorded.
- Independent final review accepted the cleanup after correcting residual
  attribution and a spacing typo; factual evidence, dates, tentative status and
  product/live-testing policy retained. Renamed-heading links resolve.
- Final tracked-text sweep retains only the requested root policy, product
  terms, evidence provenance and identity-critical historical probe strings.
- `git diff --check`, `bash -n packaging/bump-version.sh` and the same-version
  `bash packaging/bump-version.sh --version 0.1.0` consistency check passed.
  Flake files are unchanged; hosted CI remains the publication evidence gate.
