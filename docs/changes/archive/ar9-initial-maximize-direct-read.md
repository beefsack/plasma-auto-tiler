# AR9 initial maximize direct read

## Goal and scope

Seed each observed effect window from the native committed `maximizeMode()`; delete the script epoch handoff, its ActiveBorder methods, and the Rust initial-maximize state and tests. Preserve fullscreen and any-axis maximize suppression for both outlines, native transitions, and the existing drag oracle and group policy. No live KWin mutation or unrelated architecture work.

## Approach and acceptance

- Verify host KWin 6.7.5 getter and the committed-mode acknowledgement signal path before implementation. Seed on the existing load and `windowAdded` subscription; log one bounded, identifier-free state summary per observation; keep transition signals authoritative.
- Remove dead script, D-Bus, Rust, native C++ and validation references; add focused native seeding and transition coverage and delete obsolete tests.
- Run workspace Rust tests, fmt, clippy, portable check; KWin typecheck, tests, build; host-native build and matching-shell native tests. Independently review load with an already-maximized window, reload and lifecycle. Update decisions and the two specified backlog entries only, then archive this note.

## Decision and source evidence

- Orchestrator decision applying user-approved AR9 (2026-09-24): seed from committed `maximizeMode()` and rely on native maximize/fullscreen signals. Until a Wayland client acknowledges its maximize configure, it remains rendered at normal geometry, so the normal border reflects the rendered state. Reading requested mode could hide a border around a normally rendered window indefinitely if the client never acknowledges.
- Host-matched KWin 6.7.5: `EffectWindow::window()` and `Window::maximizeMode()` are available in the installed dev headers. In `src/xdgshellwindow.cpp`, `handleRoleCommit` invokes `handleStatesAcknowledged`, whose maximized delta calls `updateMaximizeMode`: the sole committed `m_maximizeMode` write emits `maximizedChanged`. `src/effect/effectwindow.cpp` forwards that to `windowMaximizedStateChanged`, already subscribed by this effect. Fullscreen acknowledgement similarly emits `fullScreenChanged`, forwarded to `windowFullScreenChanged`. X11 maximize and fullscreen transitions emit the same observed signals. No unsignaled committed-mode change was found; source is the host KWin 6.7.5 tarball `/nix/store/swkmxc7q78y2f9vlhc757zd98virhx1l-kwin-6.7.5.tar.xz`.

## Outcome and verification

- Shipped in the working tree: the effect reads committed mode on the existing `stackingOrder()` and `windowAdded` subscription, logs one redacted `observe-seed maximized=<0|1> fullscreen=<0|1>` per window, and retains native transition subscriptions. Both outlines suppress fullscreen and any maximize axis. Removed the script publisher and tests, three ActiveBorder epoch D-Bus methods and native gate, Rust `initial_maximize_*` FFI/state/tests, and obsolete validation references. No live KWin or Plasma mutation.
- Source-verified Wayland pending-ack seed: committed normal mode reflects normal rendered geometry at observation start; the ack emits the effect's subscribed changed signal. The pre-existing `AboutToChange` transition may hide earlier for a maximize request after subscription; AR9 does not change this transition behavior.
- Checks after the change: `cargo test --workspace --offline` 593 passed; `cargo fmt --all -- --check` passed; `cargo clippy --workspace --all-targets` passed with pre-existing warnings only (in untouched Rust crates); `just check-portable` passed. `kwin/`: `npm run typecheck`, `npm test` 794 passed (808 baseline minus 14 retired handshake tests), `npm run build` passed. `just build-native-effect` passed against host KWin 6.7.5; matching derivation-shell CMake build and CTest 27/27 passed. `git diff --check` passed.
- Independent Worker review: no actionable findings in effect load with pre-maximized window, reload, added/closed/deleted lifecycle, both-outline suppression, D-Bus/FFI cleanup, tests, or log redaction. Remaining live acceptance: deliver the native effect, restart Plasma session, and visually verify pre-maximized effect load/reload, newly added and normal windows, fullscreen, and transitions. The existing early-hide-on-request signal and null inner-window seed were noted as non-blocking residuals.
