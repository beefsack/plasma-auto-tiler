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
  `setsid nohup ... </dev/null &`, then proves identity from D-Bus rather
  than `$!`. `$!` is a launch hint only and never authoritative (setsid may
  fork when it is a process-group leader). After a bounded wait the owner
  PID is derived from `GetNameOwner` plus `GetConnectionUnixProcessID` and
  accepted only when `/proc/<pid>/exe` is the worktree `$BIN` or its exact
  kernel-generated `$BIN (deleted)` form, normalizes outside `/nix/store`,
  cmdline contains `planner-service`, and the
  `/proc/<pid>/stat` start identity is captured. That verified PID/exe/start
  is recorded. On failure only an already positively verified worktree
  planner is terminated, never an unverified PID or intermediate bash.
  `dev-on` then runs `scripts/start-test.sh start` with a dynamically
  derived `CONTROLLER_OWNERSHIP_FILE` under `$XDG_RUNTIME_DIR` and prints the
  verified Planner PID plus the script ID read from the controller receipt.
  Every failure after the packaged script was disabled runs fail-closed
  transactional rollback: terminate only the positively verified worktree
  planner (re-verified first), unload the KWin script only if this run
  successfully loaded it, re-enable the packaged script, remove only its own
  created receipt dir, and remove its state pointers/dir. Rollback never
  unloads a script it did not load and never touches a planner it did not
  positively verify; each failed rollback step prints a precise loud error.
  Success disarms rollback. Health requires both a verified worktree Planner
  and `isScriptLoaded=true`: when both are up, `dev-on` makes no changes; when
  both are down, it performs the normal bring-up; when only the verified
  Planner is up, it loads one controller against that Planner without starting,
  stopping, or reconfiguring either half, writes a fresh immutable receipt, and
  updates the state pointer only after re-verifying the same D-Bus owner and
  start identity; when only the controller is up, it refuses rather than
  loading a duplicate. `start-test.sh` keeps its duplicate plugin guard.
- `reload` rebuilds and safely swaps only the recorded worktree Planner. It
  never reloads or unloads the KWin script and requires the recorded
  PID/exe and current process state. The replacement is launched detached
  with `setsid nohup ... &` where `$!` is a hint only; the new PID is
  derived from the D-Bus owner (`GetNameOwner` plus
  `GetConnectionUnixProcessID`) under the same bounded wait and accepted
  only with the worktree exe or its exact kernel-generated ` (deleted)` form,
  no `/nix/store` after normalization, `planner-service` cmdline, and captured
  start identity. On failure only an already positively
  verified replacement is terminated, never an unverified PID.
- `dev-off` independently checks both halves. A loaded controller still
  requires its exact receipt and `start-test.sh stop`; an already-unloaded
  controller is never stopped with its stale ID. It terminates only a recorded
  worktree Planner that passes the existing identity checks, skips an absent or
  unverified Planner without killing it, then re-enables the packaged script.
- `dev-status` is read-only: name owner PID plus `/proc/<pid>/exe`,
  `isScriptLoaded`, recorded script ID, and installed unit state. It also
  reports `dev mode: UP`, `DOWN`, `SPLIT`, or `UNKNOWN`; `UP` requires both a
  verified worktree Planner and loaded controller.

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
# $! is a launch hint only, never authoritative (setsid may fork). Derive the
# owner PID from D-Bus and verify it before trusting it.
busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s org.plasmaautotiler.Planner
busctl --user --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetConnectionUnixProcessID s "<owner-name-from-above>"
readlink "/proc/<owner-pid>/exe"
tr '\0' ' ' < "/proc/<owner-pid>/cmdline"
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
   this worktree. Record its output; derive the Planner PID from the D-Bus
   owner (`GetNameOwner` plus `GetConnectionUnixProcessID`), never from `$!`,
   and require `/proc/<pid>/exe` to be that worktree path or its exact
   kernel-generated ` (deleted)` form (never `/nix/store` after normalization),
   cmdline to contain `planner-service`, and the start
   identity to be captured.
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
