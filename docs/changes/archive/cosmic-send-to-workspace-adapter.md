# COSMIC Send To Workspace Adapter

## Goal

- Carry the existing portable COSMIC same-output, distinct-workspace send
  operation through one standalone, development-only KWin adapter route.

## Scope

- One explicit, disabled-by-default adapter with no production startup, tray,
  KCM, autostart, or shortcut route.
- The existing Planner activation/pinned-owner sequence, `DescribePlan`
  transport, direct-geometry application, desktop-membership write, exact
  acknowledgement, and post-observation verification.
- Existing-workspace targets on the focused window's output only.

## Non-Goals

- Automatic tiling authority, Legacy fallback, workspace creation or removal,
  dynamic workspace lifecycle, cross-output transfer, group behavior, and
  shortcut registration.
- Live KWin, Plasma, or session-D-Bus execution.

## Material Correction

- The brief's target-focus wording conflicts with the approved COSMIC source
  behavior implemented in `src/session.rs`: a send with `direction=None`
  retains focus in the source-domain MRU stack, or clears tiled focus when it
  is empty. This adapter preserves that engine behavior and does not switch
  desktops or activate the moved window.

## Acceptance

- Every command resolves then pins one Planner unique owner before a Planner
  method, with one bounded activation attempt and no fallback.
- Source and target observations are bound to one owner, generation,
  correlation, and base revision. The planner commits only after exact accepted
  acknowledgement and matching verified post-observation.
- The adapter applies source and target geometry and moves only the focused
  tiled window to an existing target desktop on the same output.
- Each failure has an exact bounded route reason, including planner absence,
  owner loss, stale revision, cross-output, unchanged workspace, invalid focus,
  desktop cap, and last-desktop refusal.

## Plan

1. Extend the retained `DescribePlan` contract only as needed for a pending
   two-domain workspace send and its acknowledgement/verification phases.
2. Add an unimported KWin workspace adapter using that route and the existing
   direct-geometry ordering helper.
3. Add hermetic Rust and KWin coverage, then run the requested static suite.

## Verification

- `cargo test`
- `npm test --prefix kwin`
- `npm run typecheck --prefix kwin`
- `just --fmt --check`
- `git diff --check`
- `scripts/dev-loop-split.test.sh`

## Outcome And Evidence

- The existing `src/session.rs` and `src/contract.rs` operation was sufficient.
  The missing plumbing was the retained `DescribePlan` request, acknowledgement,
  and verification envelope plus the KWin adapter.
- `src/planner_protocol.rs:942-961` retains one owner/generation/correlation/
  base-revision-bound pending workspace session. `:2429-2652` proposes only a
  same-output distinct-workspace move, requires an exact accepted acknowledgement,
  and validates a complete post-observation before committing.
- `kwin/src/workspace-send-adapter.ts:652-1728` is an unimported standalone
  route. It resolves and pins one Planner owner, performs one bounded activation,
  applies ordered direct geometry then only mover desktop membership, verifies
  source and target post-state twice, and reports planned-flight loss to the
  pinned owner. `:85`, `:756`, and `:716-764` enforce the 25-desktop cap and
  existing same-output distinct target boundaries.
- `kwin/src/workspace-send-adapter-entry.ts:221-463` observes only the focused
  output's source and requested existing target desktop. `:472-600` exposes
  only an explicit standalone entry, with no production startup wiring.
- `kwin/tests/workspace-send-adapter.test.ts:467-1036` covers the complete
  route, Planner activation/loss/stale failures, cross-output and same-workspace
  refusals, absent/non-tiled focus, desktop cap and last desktop, post-write
  mismatches, explicit stop/disable loss, route diagnostics, and source guards.
- Static verification passed: `cargo test` (481 pass, 0 fail), `npm test
  --prefix kwin` (464 pass, 0 fail), `npm run typecheck --prefix kwin`,
  `just --fmt --check`, `git diff --check`, and
  `scripts/dev-loop-split.test.sh` (`PASS=277 FAIL=0`).

## Live-Unproven

- No live KWin, Plasma, or session-D-Bus operation ran. Hermetic fakes do not
  establish actual KWin D-Bus demarshalling, desktop membership assignment,
  geometry ordering, focus retention, or activation behavior.

## User-Owned Live Gate

- After a reviewed rebuild and explicit standalone development-route start in a
  new session, use only two existing desktops on one output and a stable tiled
  scope. Invoke one same-output send of the focused tiled window to the other
  desktop. Confirm exactly one window changes desktop membership, source and
  target geometry settle to the planned projection, source-domain focus follows
  its remaining tiled MRU stack, and `plasma-auto-tiler:route-diag` records one
  pinned-owner request, accepted acknowledgement, and verified completion. Do
  not create or remove desktops. Stop on any refusal, unexpected desktop switch,
  geometry divergence, or missing terminal diagnostic.
