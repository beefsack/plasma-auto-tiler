# Tiling Recovery Robustness

## Intent

Prevent a structural dwindle insertion failure from permanently disabling
automatic tiling for its desktop/output scope during a Plasma session.

## Scope

- Preserve automatic management after an insertion cannot produce a valid
  ordered child pair.
- Make a previously inert scope eligible for recovery on a later lifecycle
  event.
- Add regression coverage that reaches the failed ordered-child dispatch seam.
- Run at most two isolated nested-compositor topology reproductions.

## Non-Goals

- Change the dwindle blueprint shape or add capacity beyond KWin tile geometry
  limits.
- Alter host-session configuration or run a host KWin mutation.
- Change drag-and-drop or keyboard insertion behavior beyond any shared
  recoverability policy required by the defect.

## Constraints

- Follow the structural safety and hybrid-recovery rules in `docs/handover.md`.
- Nested validation uses only `scripts/nested-kwin-spike.sh` with its private
  XDG isolation contract.
- Do not edit generated `kwin/contents/code/main.js`.

## Acceptance Criteria

- A malformed/empty child geometry during dwindle insertion does not leave the
  scope permanently inert.
- A later lifecycle event can retry management for a scope that previously
  failed structurally.
- Regression tests fail before the implementation and pass after it.
- Static checks and the bounded nested topology attempt evidence are recorded.

## Decision Status

- The detailed inert-policy change remains pending source and nested evidence.
