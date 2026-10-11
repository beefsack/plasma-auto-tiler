# Licensing and release planning

## Goal and scope

- Establish code provenance, cross-platform dependency licenses, candidate-license
  consequences, and store-distribution feasibility before the user chooses a license.
- Record release-planning backlog items and remove machine-specific evidence from
  the two newest packaging records. Count affected older archives without editing them.
- No project license selection, LICENSE file, runtime changes, or live testing.

## Acceptance and approach

- Publish concise, cited findings in `docs/research/licensing.md`, including
  component-specific obligations and a recommendation with trade-offs.
- Add available license-audit tools through `devenv.nix`; inventory from existing
  metadata when the refreshed environment is pending. Do not claim a tool run
  that has not occurred.
- Add the five requested backlog items with release timing and priorities.
- Preserve substantive packaging evidence while removing local paths and resource
  constraints from the two specified records.
- Verify diffs, inventory coverage, source citations and repository-portable new
  documentation; publish after a clean rebase and inspect CI.

## Bounded work

1. Worker: provenance and Rust/npm/native dependency inventory; audit-tool setup.
2. Worker: candidate licenses and current store/platform feasibility, with sources.
3. Lead: backlog integration, archive cleanup/count, evidence review and publication.

## Decisions and evidence

- Project license remains a user decision; no LICENSE file is created.
- Store availability and license compatibility are separate questions.
- Provenance sweep found no copied third-party code; COSMIC geometry/fraction
  comparisons are behavioral research. Existing KPlugin GPL declarations remain
  provisional pending the project decision.
- Reproduced full Cargo metadata coverage: 5 workspace crates and 88 external
  packages, including Windows dependencies; all external expressions permit
  permissive choices. npm lockfile: 50 development entries (29 MIT, 21 Apache-2.0).
- Native effect uses GPL-covered KWin headers/linkage. Direct Qt/KF6 headers have
  LGPL choices; GCC runtime exception avoids application-level GPL propagation.
  Complete distribution-specific native closures remain a release follow-up.
- Independent review corrected GPL-version election, inventory grouping and
  Apple Usage Rule scope; pinned KWin header evidence was reproduced by Lead.
- Store research distinguishes current listings, grandfathered unsandboxed Moom,
  sandbox/API feasibility, current EULA terms and historical FSF enforcement.
  Recommendation preserves permissive shared-code licensing flexibility with a
  GPL effect when store optionality is prioritized; all-GPLv3 remains the
  copyleft-first alternative. Neither route is selected.
- Added cargo-deny, cargo-about and LicenseFinder through `devenv.nix` after
  pinned package availability checks. User session restart and tool runs remain
  pending; `deny.toml` is a draft, and missing first-party license fields are
  expected to fail the license check until the decision.
- Added all five requested backlog items. Removed local evidence paths and
  resource constraints from the two requested records, preserving hashes,
  test results and substantive packaging evidence.
- Counted 54 other archives containing identifiable absolute local paths or
  machine-resource flags; those archives were not edited.
- Metadata/lockfile reconciliation, source/diff review and `git diff --check`
  passed. No runtime behavior changed or live testing performed.
- Research, audit-tool declarations, backlog additions and archive cleanup
  delivered. Publication uses a clean-tree rebase; post-push CI result is
  reported in the handover. User license/name decisions, tool verification and
  the listed release research remain open backlog work.
