# COSMIC Directional Movement

## Goal

Replace legacy directional movement with the COSMIC model and no fallback.

## Scope And Acceptance

- Implement the selected COSMIC capability boundary and preserve the conformance
  corpus as an uncoupled reference.
- Production promotion requires accepted static correction evidence and
  separately authorized live acceptance.

## Current Approach

- Static correction is accepted. It resolves stale moved-window geometry after
  split, malformed-topology exceptions, non-DFS restore inequality, tile-ID
  overwrite, and stale or nonreciprocal focus links without restoring a legacy
  path.
- The corpus documents the rules and vectors at
  [COSMIC conformance](../cosmic-move-conformance.md). Supporting research is
  retained in [COSMIC evidence](../research/cosmic-evidence-mining/).

## Evidence And Next Action

- Typecheck passed; focused tests passed 17/17; keyboard tests passed 74/74
  across seven suites; the full corpus passed 1,028/1,028 across 98 suites.
  Integrated/start passed 255/0, live static passed 207/0, and the KPackage
  contract passed. Independent review accepted the correction with no findings.
- Next action: obtain separate authorization and run live KWin acceptance of
  COSMIC directional bindings. Live binding behavior remains unverified.
