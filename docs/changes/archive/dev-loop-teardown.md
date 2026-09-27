# Dev Loop Teardown

## Goal

- Make `just dev [verbose]` repeatable across Ctrl-C and suppress interactive
  pager blocking during startup.

## Scope

- Keep controller teardown receipt-bound to its exact script ID and KWin
  PID/start identity.
- Treat a strict unloaded postcondition plus matching KWin identity as positive
  teardown evidence even when `unloadScript` returns `false`.
- Ensure a verified Planner is stopped independently of controller teardown.
- Suppress pagers on interactive `busctl`, `journalctl`, `systemctl`, and
  `loginctl` invocations where present.

## Non-Goals

- No live KWin/Plasma action, lifecycle retry, plugin-name fallback, or Rust
  change.

## Acceptance

- A Ctrl-C teardown with `stop` removing the script before `unloadScript`
  returns false succeeds only with strict `isScriptLoaded=false` and the
  ownership receipt's KWin identity.
- Controller failure does not prevent teardown of an independently verified
  Planner.
- Hermetic dev-loop coverage and shell syntax checks pass.
- `just dev` captures the labeled stream to a per-session durable log
  (`$STATE_DIR/dev-log` path) via single-writer capture; the file persists
  after teardown.

## Evidence

- KWin 6.7.4 `AbstractScript::stop()` and `Scripting::unloadScript()` both
  call `deleteLater()`; the latter returns false if no matching script remains.
- Hermetic false-reply, malformed-postcondition, controller-failure/Planner,
  pager, and syntax coverage pass; no live action ran.
- Hermetic DOWN cycle asserts combined-log print at startup/teardown,
  durable labeled planner/kwin content, and single-writer serialization.
