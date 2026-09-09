# Rust Authority Login Recovery

## Goal

Keep the incomplete Rust development authority fail-closed without leaving a
persisted selection misleadingly presented as normal automatic tiling after a
login or KCM Apply.

## Scope

- Preserve `legacy` as the default and only automatic-tiling authority.
- State that Rust development has no add/remove, placement, workspace, drag, or
  existing-window adoption lifecycle and requires an already stable scope for
  its selected manual commands.
- Make KCM Apply state only what it proves: config sync plus a queued KWin
  reconfigure request. Require a session restart to establish a changed
  authority.
- Preserve on-demand Planner activation and exclusive fail-closed Rust routes.

## Non-Goals

- No Legacy fallback while Rust is selected.
- No Rust automatic lifecycle, Planner pre-warming, live KWin mutation, or
  adapter API expansion.

## Acceptance

- Existing authority/controller coverage retains Legacy and Rust
  startup/transition, existing-window Legacy attachment, shortcut and pointer
  exclusivity, repeated Apply, and fail-closed Rust dispatch.
- KCM static coverage requires the accurate restart and Rust-scope wording.
- Existing adapter activation coverage retains Planner absence until a selected
  Rust adapter request.

## Approach

1. Correct KCM authority wording and its static contract.
2. Record the bounded development-mode and recovery decision.
3. Run focused KWin, package, Rust Planner, and Nix checks; review, commit, and
   push only attributable files.

## Evidence

- Read-only deployed diagnosis on 2026-09-09: persisted
  `engineAuthorityMode=rust-development`; KWin plugin loaded/enabled; all four
  Rust entries rejected at startup and the dispatcher reported unavailable.
  The Planner descriptor is activatable, its Type=dbus unit inactive, and no
  activation attempt or Planner journal exists. This is no-first-command
  activation, not evidence of D-Bus delivery failure.

## Outcome

- KCM now states that Apply persists configuration and requests KWin
  reconfigure, but requires a user session restart before the selected
  authority may be relied on. It identifies Rust as development-only, without
  automatic tiling or existing-window adoption, and limits selected commands to
  an already stable tiled scope.
- The static KCM contract rejects restored immediate-authority wording. Existing
  controller and adapter tests retain exclusive lifecycle, repeated-Apply,
  fail-closed dispatch, and on-demand Planner activation coverage.
- Verification passed: KWin typecheck and 233 focused tests; `cargo fmt
  --check`, three focused Planner suites, and `cargo check`; `nix flake check
  --no-build --show-trace`; and `git diff --check`.
