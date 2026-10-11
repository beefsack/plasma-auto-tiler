# CI Tray Private-Bus Diagnosis

Goal: Diagnose the remaining headless tray suite failure after `23dc152`; retain the private-bus behavior checks and expose any new remote failure without access to job logs.

Observation: Fresh `23dc152` clone with a rebuilt worktree binary passes `scripts/tray-05b.test.sh` locally even under `env -i` with only Nix devenv PATH and HOME (no user session bus, XDG runtime, display, or host NixOS PATH). No Ubuntu job log is available, so the remote failure is not yet attributable to a particular assertion.

Approach: Remove implicit user-bus/systemd-dependent `busctl --user status` probes from the fixture. Query `NameHasOwner` on the exact address exported by `dbus-run-session`, where the watcher and tray processes register; preserve all registration, loss, and late-return assertions. Capture each shell suite's output and annotate the last 40 lines on failure to make any remaining remote failure diagnosable.

Outcome: Tray fixture probes now ask `NameHasOwner` on `DBUS_SESSION_BUS_ADDRESS` from their own `dbus-run-session`. The checks still require watcher acquisition/loss/return, tray ownership, single instance, and late watcher registration. CI streams each suite and annotates its last 40 output lines if it fails.

Evidence (2026-09-28): Fresh clean clone of `23dc152` in a temporary directory; `devenv shell --impure -- just build-rust`, `npm ci --prefix kwin`, `npm run build --prefix kwin`, and the exact nine-suite shell loop with the new probe/annotation passed. Tray reported 29 fixture and 16 self-test checks. Tray alone also passed under `env -i` with only the pinned devenv PATH, HOME, and worktree binary (no XDG runtime, ambient D-Bus address, display, or NixOS host PATH). A deliberately missing tray binary caused the annotation path to show the suite name and `FAIL:` line while returning failure. YAML parsed and `git diff --check` passed. No live KWin, commit, or push.

Risk: Remote logs remain unavailable; the previous `--user status` dependency is the best host-difference hypothesis, not a confirmed remote cause. The next remote run will either pass or provide the failing assertion through annotations.
