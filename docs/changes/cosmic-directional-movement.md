# COSMIC Directional Movement

## Goal

Replace legacy directional movement with the COSMIC model and no fallback.

## Scope And Acceptance

- Implement the selected COSMIC capability boundary and preserve the conformance
  corpus as an uncoupled reference.
- Production promotion requires resolving the review findings, focused static
  verification, and separately authorized live acceptance.

## Current Approach

- The candidate passed typecheck, focused, keyboard, and full-corpus static
  gates. Independent review found five blockers: stale moved-window geometry
  after split, malformed-topology exception, non-DFS restore inequality,
  tile-ID overwrite, and stale or nonreciprocal focus links.
- The corpus documents the rules and vectors at
  [COSMIC conformance](../cosmic-move-conformance.md). Supporting research is
  retained in [COSMIC evidence](../research/cosmic-evidence-mining/).

## Evidence And Next Action

- Static candidate gates passed; review did not accept promotion.
- Next action: scope work that resolves all five findings without
  restoring a legacy path.
