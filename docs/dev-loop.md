# Development Loop

Run from inside the devenv shell (`just` is provided by `devenv.nix`).
These recipes never stop or mask units, never resolve the Planner through
`/nix/store`, and never create a `result` symlink. Preconditions fail closed.

```sh
just dev-on      # disable packaged script, start worktree Planner + KWin bundle
just dev-status  # read-only: name owner, isScriptLoaded, receipt, unit state
just reload      # rebuild and swap only the recorded worktree Planner
just dev-off     # unload exact script, stop recorded Planner, re-enable packaged script
```

- `dev-on` disables the packaged KWin script, verifies `isScriptLoaded`
  `false`, requires `org.plasmaautotiler.Planner` to be unowned (it does not
  stop units for you), builds, launches exactly
  `target/debug/plasma-auto-tiler planner-service` detached with
  `setsid nohup ... </dev/null &`, proves its PID/exe and D-Bus name owner,
  then runs `scripts/start-test.sh start` with a dynamically derived
  `CONTROLLER_OWNERSHIP_FILE` under `$XDG_RUNTIME_DIR` and prints the Planner
  PID plus the script ID read from the controller receipt. If dev mode is
  already up it reports that and makes no changes. `start-test.sh` keeps its
  duplicate plugin guard.
- `reload` rebuilds and safely swaps only the recorded worktree Planner. It
  never reloads or unloads the KWin script and requires the recorded
  PID/exe and current process state.
- `dev-off` reads the script ID from the dynamically found controller
  receipt, passes both receipt (`CONTROLLER_OWNERSHIP_FILE`) and ID to
  `start-test.sh stop`, terminates only the recorded worktree Planner PID
  after exact identity checks, then re-enables the packaged script.
- `dev-status` is read-only: name owner PID plus `/proc/<pid>/exe`,
  `isScriptLoaded`, recorded script ID, and installed unit state.

## Manual Fallback

This avoids a dotfiles-nix rebuild. It uses the existing explicit `/Scripting`
loader. Tray autostart remains unchanged.

### Loop

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
setsid nohup "$PWD/target/debug/plasma-auto-tiler" planner-service >"$PLANNER_OUT" 2>&1 </dev/null &
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

### Verify

- Observe `org.plasmaautotiler.Planner` owned by the worktree Planner.
- Confirm Planner and bridge lifecycle diagnostics report `gen=local-dev`.
- Confirm `controller readiness confirmed` from `start-test.sh start`.
- In rust mode, expect `startup-handlers-ready:rust-development` and the
  `controller-ready` nonce/build check.

### Restore

```sh
devenv shell --impure -- bash scripts/start-test.sh stop <returned-script-id>
# Terminate only the recorded worktree Planner PID.
devenv shell --impure -- bash scripts/dogfood-install.sh enable
```

`start-test.sh stop` does not undo Custom Tile topology.
