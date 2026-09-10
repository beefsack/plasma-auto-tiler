# Manual Development Loop

This avoids a dotfiles-nix rebuild. It uses the existing explicit `/Scripting`
loader. Tray autostart remains unchanged.

## Loop

```sh
devenv shell --impure -- bash scripts/dogfood-install.sh disable
# Verify KWin unloaded the packaged script before continuing.
busctl --user --json=short call org.kde.KWin /Scripting org.kde.kwin.Scripting \
  isScriptLoaded s plasma-auto-tiler-kwin

# The service must be unowned before starting the worktree Planner.
busctl --user call org.freedesktop.DBus /org/freedesktop/DBus \
  org.freedesktop.DBus GetNameOwner s org.plasmaautotiler.Planner
# Only if the owner is verified as plasma-auto-tiler-planner.service:
# systemctl --user stop plasma-auto-tiler-planner.service
# Then repeat GetNameOwner and require it to fail before proceeding.

devenv shell --impure -- cargo build
PLANNER_OUT="$(mktemp /tmp/plasma-auto-tiler-planner-dev.XXXXXX.log)"
nohup "$PWD/target/debug/plasma-auto-tiler" planner-service >"$PLANNER_OUT" 2>&1 &
PLANNER_PID=$!
readlink -f "/proc/$PLANNER_PID/exe"
busctl --user status org.plasmaautotiler.Planner
devenv shell --impure -- bash scripts/start-test.sh start
```

1. Disable packaged KWin script.
2. Verify `isScriptLoaded` is `false`; reconfiguration can settle asynchronously.
3. Require `org.plasmaautotiler.Planner` to be unowned. If it is owned, confirm
   its PID belongs to `plasma-auto-tiler-planner.service`, stop only that unit,
   and recheck. If it is unmanaged or still owns the name, stop and report its
   PID and parent. Do not mask units: the D-Bus descriptor `Exec=` fallback can
   still activate the installed Planner.
4. Build and start only `target/debug/plasma-auto-tiler planner-service` from
   this worktree. Record its PID and output; `busctl` and `/proc/<pid>/exe` must
   identify that PID and worktree path.
5. `start-test.sh start` loads worktree KWin bundle. Retain its exact ID and receipt.

## Verify

- Observe `org.plasmaautotiler.Planner` owned by the worktree Planner.
- Confirm Planner and bridge lifecycle diagnostics report `gen=local-dev`.
- Confirm `controller readiness confirmed` from `start-test.sh start`.
- In rust mode, expect `startup-handlers-ready:rust-development` and the
  `controller-ready` nonce/build check.

## Restore

```sh
devenv shell --impure -- bash scripts/start-test.sh stop <returned-script-id>
# Terminate only the recorded worktree Planner PID.
devenv shell --impure -- bash scripts/dogfood-install.sh enable
```

`start-test.sh stop` does not undo Custom Tile topology.
