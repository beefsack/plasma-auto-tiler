# Workspace Send Settlement Cleanup

## Goal

- Reconcile managed workspace cleanup immediately after a successful
  workspace-send verify commit releases its source/target retention.

## Scope

- Reuse the existing workspace-send `onCommitted` settlement edge and existing
  Plan resync request.
- Keep retention through request, native follow, acknowledgement, and verify.
- Do not reconcile failed, stale, timed-out, or otherwise terminal sends.

## Acceptance

- A lone window sent from workspace 2 to trailing workspace 4 leaves workspace
  2 retained through verify, creates workspace 5 as trailing empty, then prunes
  invisible empty workspace 2 after commit without navigation or focus writes.
- Existing managed cleanup guards and send fences remain unchanged.

## Evidence

- Pending source/target retention is cleared before `onCommitted` in
  `workspace-send-adapter.ts`; the callback now preserves the coalesced Plan
  resync and invokes best-effort native workspace lifecycle reconciliation.
- The production-entry four-workspace regression retains source 2 through
  planned/follow/ack/verify, creates trailing 5, and prunes source 2 only after
  commit while preserving target 4 and mover focus.
- `npm run typecheck` and `npm test` pass (879 tests).
