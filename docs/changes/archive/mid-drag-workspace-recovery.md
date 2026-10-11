# Mid-drag workspace recovery

## Goal and scope

Recover normal tiling when a window moves to another workspace while its Meta drag remains held. Ignore the old-workspace drop target, admit on the new workspace, and reflow the source from complete observations. Treat valid observed rectangles outside work-area bounds as host geometry drift, not terminal invalid snapshots. Retain malformed-rectangle, identity, membership, owner, and correlation checks. No native-effect changes or live testing.

## Evidence and approach

- User trace `omnitiler-dev.1t4fJa.log`: send follows the mover to workspace 2 at 432-456; the later drop dispatches as cross-output at 939-959 and refuses `unchanged`; follow-up reconciles at 966-970 and 1002-1005 reject `window-out-of-bounds` (`54,586,756,478` versus `0,44,1536,980`).
- Suppress stale Started-workspace drops at the KWin adapter, preserving valid cross-output behavior. Remove observation-containment rejection in the protocol for valid native geometry and let existing convergence and plan geometry recover. Keep strict shape/homing and reply validation. Replace tests that pin the removed rejection with behavior tests for repeated convergence and the held-drag workspace transition.

## Units and acceptance

1. Rust protocol: tolerate out-of-bounds observation, retain genuinely malformed rejection, prove retained multi-window reconciliation and later commands converge.
2. KWin adapter: prevent old-workspace drop after workspace send; cover the held-drag sequence, ordinary cross-output drop, and new-workspace admission/source reflow.
3. Lead review, appropriate KWin tests/typecheck, Rust workspace tests/fmt/strict clippy, relevant shell suites, line deltas, and a concise user-operated `just dev` check table.

## Decisions and outcome

- User Resilience/Simplicity direction: observed valid out-of-bounds geometry is host drift. Orchestrator default: changed-workspace drag does not apply stale drop placement; ordinary send/admission determines its new tile. Lead choice: compare the mover's fresh native workspace to Started, rather than comparing the projected pointer destination; output moves preserve existing cross-output behavior.
- Protocol removes request-side containment checks for valid observed rectangles (including send targets), preserving malformed-rectangle, homing, focus and reply checks. KWin refuses only native same-output workspace drift before stale drop dispatch and logs a correlated `stale-workspace` rejection; ordinary drag marker reconciliation remains. Obsolete planner rejection diagnostic and tests removed.
- Regression coverage: KWin entry held-drag/send/release, destination admission and source reflow, pointer-projection/native-workspace discriminator and valid cross-output; Rust retained three-window out-of-bounds reconcile repeated, later focus, malformed rectangle, and occupied workspace-send target drift.
- Verification: `cargo test --workspace --offline`, `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --offline -- -D warnings`, KWin `npm run typecheck` and `npm test` (801 passed), `just check-portable`, `git diff --check` all passed. No shell/native files changed; no live testing. Production +20/-130 (net -110); tests +421/-123 (net +298), excluding user `devenv.nix` edit. Live acceptance remains pending on the user's test system.

## User-operated live check (`just dev`)

| Step | Expected `[kwin]` evidence | Red flag |
| --- | --- | --- |
| On eDP-1, workspace 1 with three tiled windows: hold Meta+left-drag until drop preview appears, keep holding, press Shift+2 to send the dragged window to workspace 2, then release | `component=cosmic-send ... event=follow outcome=state-confirmed`; `drag-verdict ... reason=ok-moved`; `drag-drop-refused-stale-workspace`; `drag-rejected ... reason=stale-workspace`; `drag-drop-dispatched ... accepted=false`; subsequent `kind=reconcile ... outcome=applied` in each observed domain | `drag-drop-cross-output` for that same drag, `drag-reconcile-settled ... outcome=rejected`, recurring `snapshot-invalid detail=window-out-of-bounds`, or workspace 2/1 not tiling/reflowing |
| On a tiled workspace, plain Meta+left-drag and release with the window's frame partly outside work area (valid frame dimensions) | Drop may plan or report `unchanged` depending on pointer target; later `kind=reconcile ... outcome=applied` and tiling stays usable | Repeated `snapshot-invalid detail=window-out-of-bounds`, persistent untiled frame or subsequent valid command failing |

No live KWin/Plasma test or live confirmation claimed.
