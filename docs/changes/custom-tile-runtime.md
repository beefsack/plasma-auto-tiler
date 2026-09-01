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

- The installed enabled and loaded controller differs from the checkout
  bundle.
- One project shortcut had drifted.
- Exact restoration of the existing Custom Tile topology cannot currently be
  verified.
- The fresh-session report recorded KWin PID `1852` and load object
  `/Scripting/Script0`, but did not establish authoritative membership of the
  loaded script in the checkout. The persisted tiling record references a
  desktop ID that is not live in the session, so exact restoration remains
  unproven. The unaccepted files (`devenv.nix` and the two harness scripts)
  were neither trusted nor used for this acceptance attempt; unresolved
  ownership/reconstruction diagnostics, shortcut collision/drift, and the
  unavailable `kglobalacceld` dependency blocked this acceptance attempt.
- No live runtime acceptance occurred; these preflight findings are not
  acceptance evidence.

## Current Evidence Assessment

- Read-only preflight verified KWin 6.7.4, the current checkout bundle, and the
  private KWin/DBus/kwinrc primitives, but the current session lacks the newly
  declared `kglobalacceld` until devenv is restarted.
- No KWin process or client was launched by this acceptance attempt, and no host
  mutation occurred. Runtime behavior, host restoration, and every acceptance
  journey remain unclaimed.
- Live execution is rejected for this evidence set: documented
  `--no-global-shortcuts` conflicts with controller readiness and global
  shortcut semantics; private KWin/DBus/kwinrc provenance and interruption-safe
  restoration remain unproven; and the harness lacks authoritative exact
  readiness and native-client evidence.

## Verification

- Static implementation evidence is accepted; the unaccepted files (`devenv.nix`
  and the two harness scripts) are not acceptance evidence. No live Custom Tile,
  drag/reflow, and related journeys were run.

## Material Decisions And Accepted Evidence

- Stable nested split-tree behavior is an MVP dependency for COSMIC movement
  and nested placement.
- Accepted isolated evidence covers deferred reconstruction after removal, but
  does not establish one-to-zero cases, detached-window close, physical
  shortcuts, or host live acceptance.

## Next Action

- Live acceptance is blocked; no manual live scope is pending. If reopened, the
  user must create and own the disposable host and session boundary and perform
  the physical observations; avoid the existing topology, installed controller,
  and existing shortcut.
- Before any mutation, identify the owned desktop, windows, and tile state and
  verify the exact restoration check. Stop on any ownership or restoration
  ambiguity. No runtime or acceptance result may be recorded until that proof
  completes.
