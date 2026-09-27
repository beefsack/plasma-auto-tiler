# Resilience change 4 (offline)

## Goal and scope

- Implement ordinary recovery findings C1-C3 from [the fail-closed sweep](../fail-closed-sweep.md): KWin entry attachment retry, tray startup owner-query recovery, and Planner malformed owner-signal handling.
- Preserve exact authorization, identity, geometry and partial-write fences. C4 tray ordering and the live-settings launch gate require separate user decisions and are out of scope. No live KWin testing, commits or pushes. Preserve the already accepted uncommitted Changes 3a and 3.

## Acceptance and bounded units

1. C1: complete attachment retries safely after transient startup failure, with cause/recovery logs, no actuation while unattached, hard missing API remaining terminal. Focused tests.
2. C2: startup owner-query error leaves tray serving, later owner-changed signals resolve owner live, watcher retry remains live-confirmed, KWin publisher authentication unchanged. Focused tests.
3. C3: malformed owner signals/args are logged and skipped, while lost connection/name remains terminal. Focused tests.
4. Verify KWin `npm test` and typecheck, Rust workspace tests, and `git diff --check`. Record evidence, archive this note, and update the sweep and backlog status after passing checks.

## Evidence and outcome

- **C1:** Entry-owned `windowAdded`/`configChanged` attachment retries until success or stop, one attempt per event. No timer or arbitrary cap: these events can fire with the adapter unattached. No shortcuts, plan requests, or native actuation before all required subscriptions connect; missing `windowList`, `callDBus`, or `QTimer` stays terminal. A failed attempt logs `plasma-auto-tiler:plan:entry-attach stage=failed cause=<subscription-kind> recovery=retry-on-native-event` once; successful recovery logs `stage=recovered`. Source delta approximately 200 lines, focused tests approximately 150 lines. Remaining boundary: existing windows with no subsequent window-add/config event remain unobserved until such an event; no polling or independent retry timer is selected. Unexpected post-enable throws are terminal rather than treated as safely detached retries.
- **C2:** Initial watcher/KWin owner-query errors, including proxy construction errors, map to unknown and leave the tray serving. Existing watcher signal/watchdog rechecks recover registration; an authorized publisher whose sender matches a freshly confirmed live KWin owner can recover an unknown KWin cache without an owner-change event. A different cached owner is never silently replaced, and the post-publish owner race check stays. New redacted `component=tray-endpoint stage=owner event=startup outcome=query-failed`; existing watcher `stage=watcher event=query outcome=query-failed` and `event=register outcome=registered` signal failure and recovery. Source delta approximately 65 lines; focused tests approximately 100 lines. No extra watcher/KWin polling.
- **C3:** Malformed owner signals and undecodable args skip that event, emitting fixed best-effort stderr `component=planner stage=owner event=signal outcome=malformed-signal|invalid-args`. Transport iterator errors and real own-name/connection loss remain terminal. Source delta approximately 40 lines; focused tests approximately 100 lines. No service-name inference from undecodable events.
- **Offline verification:** KWin `npm test` **766/766**, `npm run typecheck` passed; Rust `cargo test --workspace` passed after production changes; `cargo test -p plasma-auto-tiler` **86 library and 9 integration tests** passed after removing obsolete startup-reconciliation helper/test; `git diff --check` passed. No live KWin/Plasma check or runtime-frequency claim. Exact log forms are in `docs/dev-loop.md`.
- **Outcome:** C1-C3 implemented and source/behavior verified offline. C4 tray ordering and the settings launch-gate decision remain separate and untouched.
