# COSMIC Directional Movement

## Goal

Deliver COSMIC-style tiling movement for the MVP, replacing legacy directional
movement with no fallback.

## Scope And Non-Goals

- Implement the selected COSMIC capability boundary and preserve the conformance
  corpus as an uncoupled reference.
- This record covers directional movement, not true compositor groups, tabs,
  stacked/shared groups, or the nested-placement UI replacement.

## Acceptance

- Directional movement preserves the selected nested split-tree semantics and
  passes the conformance corpus.
- Production promotion requires accepted static correction evidence and
  separately authorized live acceptance.

## Approach And Dependencies

- The COSMIC path depends on a stable Custom Tile runtime and is accepted only
  without a legacy fallback.

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

## Material Decisions And Accepted Evidence

- COSMIC-style tiling movement is MVP. Grouping means nested split-tree
  structure and placement; `H[H[1 2] 3]` differs from `H[1 H[2 3]]`.
- Static correction is accepted; no live result is claimed.
