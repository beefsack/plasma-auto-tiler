# Tray and Planner resilience fixes

## Goal and scope

- Restore tray availability during `just dev` and across missing/restarting StatusNotifierWatcher, and address audit rows M, N, O, P, Q. No KWin script changes or host live testing.
- `just dev` owns only its worktree tray process, includes its diagnostics in the labeled dev trace, and stops only that instance. Dogfood remains on demand; Home Manager autostart remains optional.
- A duplicate dev tray exits cleanly and logs that an installed tray owns the name. Loss of the tray's own name or connection remains terminal.

## Acceptance and approach

- M: no watcher at startup/loss leaves tray serving; a live-confirmed owner is registered, and transient registration errors remain retryable without falsely claiming success. Update the Tray decision.
- N: malformed owner messages/args and failed notification sends are logged and recoverable on later valid events; own-name/connection loss remains terminal.
- O: log poisoned Planner state, replace it with fresh state, converge on subsequent complete observations; do not claim retained layout survived.
- P: bound awaited SNI emission under the notification lock and release it on failure, allowing a fresh projection. Account for owner lookups awaited under the publication lock; avoid extra machinery.
- Q: recover poisoned tray and drag-oracle locks while preserving fresh-observation and FFI panic-containment semantics.
- Extend lean row-specific behavioral coverage and existing hermetic dev lifecycle shell suite only if it covers the foreground lifecycle. Mark M/N/O/P/Q fixed in `resilience-audit.md` and update `docs/dev-loop.md`.

## Units and verification

- Bounded implementation units: dev loop, M, N, O, P, Q; one fresh Worker at a time. Independent final-diff review by a Worker that wrote none of the code.
- `cargo test --workspace --offline`; `cargo fmt --all -- --check`; `cargo clippy --workspace --all-targets --offline -- -D warnings`; `just check-portable`; relevant shell suites; `git diff --check`. KWin checks only if KWin changes.
- Host session and processes are not touched; user owns later live acceptance: start `just dev`, see tray and labeled diagnostics, restart plasmashell and confirm re-registration, confirm teardown preserves an installed tray.

## Outcome and evidence

- Initial read-only investigation at `348ed8a`: no tray process/name, watcher owned by kded6, no Home Manager tray autostart, no current-boot tray journal matches. `just dev` did not launch tray; watcher exit was a separate source-verified risk, not an established cause of that absence.
- Implemented foreground dev tray ownership, labeled log capture, and identity-checked teardown; M/N watcher and signal recovery; O fresh Planner after lock poison; P bounded SNI emission and KWin-owner lookup; Q tray/drag-oracle poison recovery including same-revision KWin heartbeat. Decisions and audit updated.
- Offline after latest Rust change: `cargo test --workspace --offline --quiet` 608 passed, 0 failed; `cargo fmt --all -- --check`, strict workspace clippy, `just check-portable`, `git diff --check` passed. Private-bus tray-05b: 29 fixture + 16 self-test checks. Hermetic dev loop: 367 passed, 0 failed, including live owned tray teardown and changed-identity refusal; dev-native-effect: 163 passed, 0 failed. No live host session mutation or KWin/Plasma test.
- Independent read-only final-diff review found three low-severity gaps and one dev-test coverage gap; corrected poisoned watcher lock recovery, change-driven watchdog emission diagnostics, verified-child cleanup on startup timeout, and live-owned/changed-identity hermetic coverage. The dev/native fixture fixes restored their existing checks. A fake watcher method-output assertion was replaced by the tray's post-call-confirmed registration record.
- Remaining evidence limits: actual bus-hang cancellation, panel visibility, login/autostart ordering, plasmashell restart, and real session teardown await user live checks. If `setsid` forks before a timeout and the child never acquires the bus name, its identity cannot be proved, so `just dev` reports unresolved rather than killing an ambiguous PID. Next action: Orchestrator stages/commits the verified diff; user performs live acceptance on their machine.
