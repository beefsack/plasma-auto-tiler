# Authority Adapter Attachment Investigation

## Goal

Identify the static cause of the Rust authority adapter startup failure.

## Scope And Non-Goals

- Static source and test-fixture investigation only.
- No KWin/Plasma, D-Bus, build, script-load, Planner, or packaged-route action.
- No behavior change is included.

## Accepted Evidence

- Adapter `ready` is logged only after every required subscription returns a
  detach function. The reported `ready -> disabled -> entry reject` sequence
  instead takes the post-enable `observeNative(...) === null` branch in each
  entry.
- The three `*-entry-signal-failed` labels are therefore misleading for this
  observed path; pointer uses `pointer-entry-invalid` for its corresponding
  scope rejection.
- KWin 6.7.4 declarations and repository API research list every required
  workspace and interactive-window signal. The static fixtures manufacture an
  ideal signal/scope world, so they cannot prove live observation compatibility.

## Outcome

- Do not relax geometry or signal validation without a discriminating live
  observation. Minimal low-risk follow-up: distinguish post-enable scope
  rejection from connection failure and add bounded scope-reason diagnostics.

## Next Action

- None.
