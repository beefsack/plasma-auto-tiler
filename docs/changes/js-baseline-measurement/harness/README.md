# Harness design notes (unit-04)

`run.sh` drives one baseline-measurement sweep: one variant (`a` or `b`) at
one window count N. `--dry-run` prints the exact sequence of commands a real
run executes without executing any of them; the non-dry-run mode is what
unit-05/unit-06 invoke during the live sweeps. This file records every design
choice the brief left open, so unit-05/unit-06 can follow it exactly without
re-deriving it. Where a choice interacts with a spec or README requirement,
the requirement is quoted and my reading stated.

## Test-window class and why xterm

- Distinctive class (the literal string everywhere in this harness):
  `PlasmaAutoTilerTestWindow`.
- Spawn command (exact): `setsid xterm -class PlasmaAutoTilerTestWindow -e sleep 3600 >/dev/null 2>&1 &`
- The `-class` string, the `managedResourceClass` value written to kwinrc,
  and the class the scripts filter on are the same single literal string
  (`TEST_WINDOW_CLASS` is the only definition; every trace/exec path expands
  it). They cannot drift.
- Why `xterm -e sleep 3600`: creates a window immediately with no interactive
  input, and holds it open for a bounded 1 hour. The hold must exceed the
  longest possible run (the scripts' own watchdog default is 5 minutes), so a
  window can never close itself mid-run and skew the measurement; the bounded
  sleep also guarantees no window outlives the harness even if teardown is
  never reached. `-e` must be the last option (xterm 410 man page); it is.
- Flag validity was confirmed from the local man page
  (`/nix/store/...-xterm-410/.../xterm.1.gz`), not by running xterm. `-class
  string` sets the WM_CLASS class value that KWin surfaces as
  `window.resourceClass`; `-e program args` runs the program in the window.
  No xterm was invoked live in this unit (the brief's doubt rule: any doubt
  about a given xterm invocation opening a window means do-not-run).
  Residual risk for unit-05: whether KWin reports this window's
  `resourceClass` as exactly `PlasmaAutoTilerTestWindow` on this host is
  expected but not yet observed; unit-05's 1-window smoke test must confirm a
  spawned window actually triggers the script (log lines appear) before the
  full sweep.
- Why `setsid`: each xterm becomes its own session/process-group leader, so
  teardown can `kill -- -<pid>` the whole group (xterm plus its `sleep`
  child). Killing only the xterm PID would leave the `sleep` orphaned for up
  to 3600 s; the group kill cleans both.

## RSS sampling

- Sample points (three per run, in this order):
  1. `baseline_no_script_kb` - before the script is loaded, no script.
  2. `loaded_no_windows_kb` - script loaded+started, zero test windows.
  3. `loaded_<N>_windows_kb` - script loaded, N test windows present.
- Spec wording (spec.md Acceptance Criteria): "RSS delta of the
  `kwin_wayland` process (script loaded vs. not loaded) is reported at each of
  the 5, 20, 50, 100 window-count tiers". My reading: "script loaded" means
  the loaded-with-N-windows state at that tier (that is the state the tier is
  about - the script actively managing N windows), so the tier RSS delta is
  `loaded_<N>_windows_kb - baseline_no_script_kb`. Sample 2 is kept because it
  costs almost nothing and lets the findings report split the delta into
  pure script-load cost (`loaded_0 - baseline`) versus per-window growth
  (`loaded_N - loaded_0`); for Variant B the per-window growth is the GC
  pressure the spec cares about. The spec's minimum is satisfied by sample 1
  and sample 3 at each tier.
- Process sampled: the real `kwin_wayland` compositor, not
  `kwin_wayland_wrapper`. "RSS of the kwin_wayland process" means the heap
  where KWin and the QJSEngine/script allocations live, which is the
  compositor process (observed: PID 2532, ~270 MB RSS) and not the small
  launcher wrapper (PID 2527, ~21 MB RSS).
- Finding that changed the sampling command: `pgrep -x kwin_wayland` returns
  NOTHING on this NixOS host. The comm name is truncated to 15 characters and
  dot-prefixed: the compositor's comm is `.kwin_wayland-w` and the wrapper's
  is `.kwin_wayland_w`, so `-x` exact match fails for both. The working
  command is `pgrep -f '[k]win_wayland --'`: the full command line of the
  compositor contains `.../kwin_wayland --wayland-fd ...`, which the wrapper's
  `kwin_wayland_wrapper --xwayland` does not contain. The `[k]` bracket makes
  the literal pattern not match the pgrep's own invoking shell. Verified live
  (returns exactly 2532). The harness aborts if the command returns zero or
  more than one PID.
- Baseline freshness: a fresh `baseline_no_script_kb` sample is taken
  immediately before each run, never reused across a tier sweep. A reused
  baseline would silently absorb drift from unrelated system activity over the
  minutes a sweep takes; the cost of re-sampling is one `ps` call.
- Each sample is preceded by `sleep 1` so the relevant allocation phase (script
  load, or N-window placement plus QJSEngine heap growth) has settled before
  the read.

## dbus-monitor capture and demux

- Command shape:
  - `rm -f $SINK_FIFO && mkfifo $SINK_FIFO`
  - `stdbuf -oL dbus-monitor --session "type='method_call',interface='com.plasmaAutoTiler.LogSink'" > $SINK_FIFO 2>/dev/null &`
  - `awk -v reallog=<real log> -v ampa=<variant-a-amplified.log> -v ampb=<variant-b-amplified.log> '<program>' < $SINK_FIFO &`
- The filter is the one proven live by the clock-resolution probe (same
  interface filter). The method call is observable even though no service owns
  the reserved name.
- Demux rule (per README "How a line reaches the file" and the amplification
  demux rule): awk reads the dbus-monitor textual stream, extracts the single
  `string "..."` argument of each `append` method call, and routes by the
  first CSV field - `amplified-a` to `variant-a-amplified.log`,
  `amplified-b` to `variant-b-amplified.log`, everything else (the
  `windowAdded`/`windowRemoved` measurement lines AND the 3-field
  `watchdog-a`/`watchdog-b,fired,<ms>` run-level events) to this variant's
  real-dispatch log. This keeps watchdog lines out of the measurement
  distribution and in the real log where parsers must skip them anyway.
- Two buffering hazards are both closed:
  - `stdbuf -oL` line-buffers dbus-monitor's stdout so records reach awk
    immediately instead of piling in dbus-monitor's userspace buffer (the
    tail of a run would otherwise be lost when dbus-monitor is killed).
  - awk `fflush()`es after every written line, so no line sits in awk's file
    buffer when awk is killed at teardown.
- A FIFO (not a plain pipe) is used so both processes' PIDs are captured and
  the pipeline is torn down explicitly (`kill $DEMUX_PID $MONITOR_PID`), which
  also removes the FIFO. A plain pipe would only expose the last process's PID
  and would orphan dbus-monitor.
- The demux awk program and the FIFO plumbing were validated offline against a
  simulated dbus-monitor stream (all routing cases: measurement lines, both
  amplified tags, watchdog line). The live dbus-monitor path was already
  proven by the clock probe; unit-05's smoke test validates the end-to-end
  capture during a real run.

## Settle delays

- `sleep 0.5` between spawns: lets each window's KWin placement and the
  variant's synchronous handler complete before the next spawn. Rationale:
  (a) Variant B's managed-window model grows deterministically, one add per
  step, so its N-writes-per-event reconciliation workload is exercised at
  each intended count; (b) per-event `Date.now()` timings are less likely to
  be coalesced into the same 1 ms bucket, preserving as much of the
  distribution as the 1 ms clock can resolve; (c) unit-05's Q1 frame analysis
  can attribute a frame to a specific spawn when spawns are separated. The
  spec's "synthetic spam vs. real usage" validity caveat still applies because
  0.5 s-spaced spawns are far denser than real usage.
- `sleep 2` after the last spawn (before the N-windows RSS sample): lets
  placement and geometry writes settle so the RSS read reflects steady state.
- `sleep 2` after teardown (before stopping capture): lets the teardown's
  `windowRemoved` events flow through the D-Bus log sink and into the files.
  With `stdbuf` + `fflush()` this is near-immediate; the 2 s guards against
  residual asynchronous bus delivery.
- `sleep 1` before each RSS sample (see RSS section).

## Teardown and leak verification

- Tracked PIDs: each spawn's `$!` after `setsid xterm ... &` is the new
  session/process-group leader (xterm itself). Teardown kills each group with
  `kill -- -<pid>` (falling back to a plain `kill <pid>`), which closes the
  window (and, for Variant B, triggers the measured `windowRemoved`
  reconciliation).
- Leak verification: `pgrep -f 'xterm -class PlasmaAutoTilerTestWindow'` must
  return nothing after teardown. Window-listing tools are absent on this host
  (`wmctrl`, `xdotool`, and `xwininfo` were all confirmed missing), so a
  process-level check is the primary method. It is adequate here because the
  leak we care about is a leftover test window, and every test window is a
  live xterm process with this exact command line; a window can only exist
  while its xterm process exists. Unit-05 may additionally eyeball the desktop,
  but the harness's automated check is process-based.
- The harness does NOT build automatic cleanup beyond refusing to run (see
  next section): a crashed prior run that left windows or a capture behind is
  surfaced as an error for a human to clean, not silently swept.

## Idempotent / safe re-run

- Real mode refuses to proceed if any of these is true (checked first, all
  read-only): the plugin is already loaded (`isScriptLoaded` true), leftover
  xterm test windows exist, a leftover `dbus-monitor ... LogSink` capture is
  running, or a required tool is missing. It also warns (does not abort) if
  `amplify` is not at its default `"0"` for this variant, since the main sweep
  must run with amplification off. Dry-run mode prints all of these as the
  checks that would run, so a human can inspect the session before the live
  sweep.
- Every run starts with truncation of the two log files and a fresh FIFO, so
  re-runs are clean by construction.

## Config keys written (and explicitly not written)

- Written: `managedResourceClass` = `PlasmaAutoTilerTestWindow`, in group
  `Script-<pluginName>`, via `kwriteconfig6 --file kwinrc --group Script-<pluginName> --key managedResourceClass <class>`, followed by `qdbus org.kde.KWin /KWin reconfigure` (required for the fresh key to be visible).
- Explicitly NOT written (state left at defaults, per the brief): `amplify`
  stays `"0"` - amplification is a separate calibration pass out of this
  unit's scope - and `watchdogMaxLifetimeMs` stays `"300000"`. The dry-run
  header states this, and real mode's pre-flight warns if `amplify` is not
  the default.

## Real mode status

- Real mode is written but has NOT been executed in this unit (non-invasive
  scope). Syntax was validated with `bash -n`. The live-session steps
  (config write, load/start, spawn, teardown, unload) are exactly what
  unit-05/unit-06 run after the Orchestrator authorizes the invasive units;
  unit-05's smoke test is the first real execution and should validate: the
  resourceClass actually matches the spawned windows, the log sink lines land
  in the right files, and teardown removes all windows.
