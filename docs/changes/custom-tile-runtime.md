# Custom Tile Runtime Acceptance

## Goal

Establish a stable Custom Tile runtime for the MVP, including drag/reflow,
floating, fullscreen, maximize, and workspace behavior on KWin.

## Scope And Non-Goals

- Static implementation is delivered. Live claims require the procedures in
  [the live testing guide](../live-kwin-testing.md) and the reviewed standing
  live-test boundary/protocol in [the project decisions](../decisions.md).
- Drag signal delivery, reflow, motion cleanup, cadence, and XWayland behavior
  remain unproven. The KWin client-realization drag gap is not an engine defect.
- Deferred window eligibility now attaches the same interaction handlers as the
  immediate path; its static evidence is accepted, while the generic Steam
  move/placement journey remains parked.
- True tabs, stacked windows, shared tiles (multiple windows per tile), and
  compositor-owned groups are outside this MVP record; nested split-tree
  structure remains in scope.

## Acceptance

- On disposable, project-owned topology with exact restoration, Custom Tile
  structure remains stable through window add/remove, drag/reflow, floating,
  fullscreen, maximize, and workspace journeys.
- Live runtime acceptance requires user-performed physical or manual
  observations; session boundaries require user action; no unperformed live
  result is claimed.

## Approach And Dependencies

- Re-resolve tile handles after structural removal and reconstruct only through
  the accepted deferred path.
- The COSMIC movement and nested-placement records depend on this runtime's
  stable tree behavior.

## Material Safety Finding

- Never run `remove()` followed by `split()` against a changed tile tree, use a
  timer as a deferred-deletion barrier, or run structural probes in a persistent
  user scope. Re-resolve tile handles after removal.
- Isolated nested evidence supports deferred reconstruction that re-resolves
  after removal. It proved 4-to-3 and 3-to-2 rebuilds, but did not establish
  one-to-zero cases, detached-window close, physical shortcuts, or host live
  acceptance.

## Read-Only Preflight

- The accepted static harness is a current-session read-only preflight. It
  strictly diagnoses KWin and KGlobalAccel ownership, and fails closed on stale
  state, shortcut collision or drift, service drift, and provenance ambiguity.
- It establishes a prospective rollback and journal contract for a later
  authorized run only. It performs no lifecycle or mutation and persists no raw
  host evidence.
- `authoritative_ready` remains false because no supported read-only binding
  proves the checkout controller's provenance. This is the immediate blocker.
- No live runtime acceptance occurred; preflight results are not acceptance
  evidence.

## Current Evidence Assessment

- `devenv.nix` intentionally adds `python3`. Restart the development session
  before assuming that dependency or the preflight is available.
- No live lifecycle or mutation occurred. Runtime behavior, host restoration,
  and every acceptance journey remain unclaimed.
- Live acceptance remains blocked until after restart and a read-only preflight
  reports `authoritative_ready: true`.

## Verification

- Static/read-only harness verification passed: 73 passed, 0 failed. Bash
  syntax, `--help`, Nix parse, and diff checks passed; `shellcheck` was
  unavailable.
- An independent adversarial safety review had no final findings.
- This is harness/preflight verification only. No live Custom Tile, drag/reflow,
  or related journeys were run.

## Material Decisions And Accepted Evidence

- Stable nested split-tree behavior is an MVP dependency for COSMIC movement
  and nested placement.
- Accepted isolated evidence covers deferred reconstruction after removal, but
  does not establish one-to-zero cases, detached-window close, physical
  shortcuts, or host live acceptance.

## Next Action

- Restart the development session, then run the read-only preflight. Do not run
  live acceptance before the restart.
- Request user physical or manual action only if that preflight reports
  `authoritative_ready: true`; otherwise stop without a live attempt.
- Prioritize a supported read-only checkout-controller provenance binding. Until
  it exists, `authoritative_ready` remains false and no live gate opens.
