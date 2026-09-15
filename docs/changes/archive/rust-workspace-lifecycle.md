# Rust Workspace Lifecycle

## Goal

- Restore legacy dynamic virtual-desktop lifecycle and numbered workspace/send
  shortcuts in the current Rust-authority production runtime.

## Scope

- Keep Rust as the structural/policy authority for same-output tiled sends.
- Restore the legacy project-owned KWin backing-desktop mapping for
  `per-output-local`, `global-unique`, and `shared` workspace modes.
- Restore `Meta+1..9`, `Meta+0`, `Meta+Shift+1..9`, `Meta+Shift+0`, and their
  established shifted-symbol aliases without mutating foreign shortcuts.
- Maintain one trailing empty backing desktop per relevant domain; retire only
  safe, project-owned empty desktops.

## Non-Goals

- Controller revival, cross-output transfer, hotplug recovery, runtime
  collision reconciliation, polling/retries, or a new topology authority.
- Changes to floating, sticky, fullscreen, maximize, or group highlighting
  semantics.

## Decisions

- Native KWin adapter state owns the restored backing-desktop mapping and
  desktop observation/actuation. Rust continues to own tiled send structure,
  focus, and geometry through the existing same-output send route.
- Numbered sends follow the moved tiled window only after the Rust plan is
  accepted and its target/object/domain post-observation is verified. Rust
  expresses target mover focus; the KWin adapter only performs that native
  follow after commit. Numbered focus selects the requested existing workspace;
  zero reuses the trailing empty workspace before creating one.

## Verification

- Compare the restored lifecycle and chord catalog with deleted legacy source.
- Add focused KWin lifecycle/shortcut routing tests plus existing Rust
  send-to-workspace coverage, then run typecheck, targeted tests, build, and
  formatting checks.

## Outcome And Evidence

- `WorkspaceNativeAdapter` restores the legacy session-local backing-desktop
  lifecycle through public KWin APIs. It creates or reuses literal trailing
  empty desktops, preserves populated/current/visible/unowned desktops, and
  retains the two-desktop global floor across all three selected modes.
- Production registration includes `Meta+1..9`, `Meta+0`,
  `Meta+Shift+1..9`, `Meta+Shift+0`, and `Meta+!` through `Meta+)`. Numbered
  sends use the Rust `MoveToWorkspace` path and restore legacy target follow:
  exact accepted/verified sends switch to the target and focus the mover;
  rejected, stale, mismatched, and duplicate replies do not follow or reapply
  membership changes.
- `npm run typecheck`, `npm test` (603 pass),
  `cargo test --test session_send_to_workspace` (4 pass),
  `cargo test --lib workspace` (17 pass), `just --fmt --check`, and
  `git diff --check` passed. No live KWin or physical-shortcut action occurred.
- User pickup: stop foreground `just dev` with Ctrl-C for clean teardown, then
  restart `just dev verbose`. No logout is required for this Rust/TS-only change.
