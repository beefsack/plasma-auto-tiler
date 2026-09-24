# AR13 Same-UID-Trusted Tray

## Goal and scope

- Ship the user-approved 2026-09-24 tray threat model: same-UID processes trusted, current KWin bus owner alone publishes snapshots, D-Bus name ownership gives one tray instance.
- Remove executable allowlists, `/proc`/pidfd/inode/PID/lock binding, associated commands, unused Cargo features, obsolete tests and active documentation.
- Preserve the Planner same-UID check and existing SNI projection, freshness, ordering, and watcher behavior. No live KWin/Plasma or host mutations.

## Delivery and lifecycle choice

- Use XDG autostart, already delivered by Home Manager; dev/dogfood use `cargo run -p plasma-auto-tiler -- tray` on demand. Dogfood's KWin installer has no tray binary/package lifecycle; a persistent dogfood autostart would require a second installer and duplicate the Home Manager-owned entry. A second invocation exits successfully when the name is taken.
- The tray remains running on KWin owner loss, clears the stale snapshot, and accepts the new owner's first valid snapshot. It stops on its own name/connection loss or session teardown. No automatic restart of a crashed tray before the next login.

## Acceptance and units

- Rust endpoint, CLI, and regression coverage: name acquisition/loss, accepted current-owner snapshots, refused other sender with bounded reason, owner replacement/race, Planner check unchanged.
- Dev/dogfood on-demand and Nix/Home Manager autostart entry points plus relevant shell suites reflect one `tray` command and one XDG autostart file, no old helper commands.
- Bounded redacted logs include lifecycle and snapshot outcome; existing stderr only, with tray stderr sink backlog still open.
- Run workspace offline tests, format, clippy, portable check, KWin typecheck/test/build, affected packaging shell suites; independent review of diff. Native build/tests only if native files change.

## Outcome and evidence

- Removed the full tray lifecycle implementation and mechanism tests (5,848 lines), both obsolete shell suites, the allowlist and executable identity logic, six CLI modes, and unused `rustix` filesystem/runtime/memory features. `rustix` remains for Planner's `geteuid()` check.
- Offline: `cargo test --workspace --offline` 624 passed, fmt and clippy passed (warnings only in unchanged files), `just check-portable` passed; KWin typecheck, 816 tests, build passed. Private-bus `tray-05b` 19 fixture + 16 self-test; dogfood 572, dev-native 163, host-builder 93 passed. `nix flake check --no-build --offline` passed; no Nix package runtime build or live Plasma test claimed.
- Independent review found only low-severity/informational items. Corrected transient post-query failure heartbeat recovery, misleading accepted-before-revoked log, default Nix test fallback, and historical active-doc suite names; second review found no blocking issue. A queryable sink for XDG-autostart tray stderr remains pending in the observability backlog.
- Live acceptance: in a fresh user session with Home Manager tray enabled, confirm exactly one tray name owner/SNI, KWin-origin status and settings, KWin restart clearing then fresh snapshot, watcher ordering, autostart/login, package update and rollback. Check tray stderr capture as a separate observability item. User owns session boundary and visual observations.
