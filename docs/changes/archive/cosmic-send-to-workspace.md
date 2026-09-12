# COSMIC Send To Workspace

## Goal

Add a portable, source-evidenced `cosmic_v1` operation that sends the focused
tiled window to another workspace on the same output.

## Scope

- Portable Rust topology, complete geometry/focus plans, and existing lifecycle
  acknowledgement plus post-observation fencing.
- Same-output, distinct-workspace transfers only.

## Non-Goals

- Adapter wiring, shortcut registration, production activation, and live KWin.
- Cross-output R4 transfer: COSMIC's boundary behavior is a different
  `MoveFurther` escalation path, not the frozen local R4 rule.
- COSMIC stack/fullscreen/floating transfer paths and full focus-stack history.

## Source Evidence

- `pop-os/cosmic-comp` `81cd5fdbaa41c3973369ae85bccf829137836e20`:
  `src/input/actions.rs` `MoveToWorkspace`/`SendToWorkspace` (284-311) calls
  `Shell::move_current` with `direction=None`.
- `src/shell/mod.rs` `move_element` (3448-3556) unmaps the source then maps
  the tiled element in the target and selects it as the keyboard focus target.
- `src/shell/layout/tiling/mod.rs` `map_to_tree` (563-613) chooses the focused
  target leaf, or output/root geometry when none is focused; `unmap_internal`
  (1446-1492) recursively collapses the source tree. `Data::{new_group,
  remove_window}` (177-191, 255-283) establish equal new splits and
  proportional removal shares.

## Plan

1. Add a lifecycle operation/capability and a `Session` command that carries
   exact source and target domains.
2. Require the portable global focus to equal the moved window. Use the target
   domain's valid last-active leaf, or the source-evidenced root/output-
   geometry fallback, then reuse admission/removal, projection, and lifecycle
   reconciliation helpers.
3. Add Session/lifecycle conformance, refusal, and reconciliation coverage;
   run Rust formatting, checks, clippy, and tests.

## Acceptance

- Source removal collapses recursively; target admission is empty-root or an
  equal split of the target domain's valid last-active leaf, with root/output
  geometry fallback when none remains.
- The focused moved window is focused in the target domain. The portable model
  retains one validated last-active leaf per domain, not full stack history.
- Source and target geometry are complete, and one-pending acknowledgement plus
  matching post-observation verification remains mandatory.
- Same-output workspace isolation remains intact for directional R1-R4.

## Material Decision

- Do not implement local cross-output R4: upstream escalates directional
  boundary movement to workspace/output actions and does not provide the local
  whole-target-tree transfer semantics. Recreating the frozen local rule would
  be speculation, not COSMIC parity.

## Verification

- `cargo fmt --check`
- `cargo check --all-targets`
- `cargo clippy --all-targets -- -D warnings`
- `cargo test`

## Outcome And Evidence

- `SessionCommand::MoveToWorkspace` emits a `MoveTiled` lifecycle operation
  gated by `LifecycleCapability::MoveTiled`; acknowledgement and matching
  post-observation remain mandatory before commit.
- The source gate accepts only the global focused tiled window. Empty targets
  become a lone root; occupied targets split their validated last-active leaf
  with equal shares using the source-evidenced geometry axis, falling back to
  root/output geometry when needed. Source collapse, complete two-domain
  geometry, link retargeting, focus, refusal, pending, capability-divergence,
  and verification mismatch coverage are in `tests/session_send_to_workspace.rs`.
- No lifecycle fixture lock exists because this portable lifecycle contract has
  no serialized fixture or selected adapter route. A fixture would be invented
  rather than lock an emitted public payload.
