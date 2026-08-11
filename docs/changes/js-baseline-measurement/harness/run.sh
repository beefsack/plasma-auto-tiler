#!/usr/bin/env bash
set -euo pipefail

# Baseline-measurement harness for the JS-baseline-measurement change.
#
# Runs one sweep for one variant at one window count: captures the variant
# script's LogSink lines via dbus-monitor (demuxed into the real-dispatch log
# and the amplified log), samples kwin_wayland RSS at three points, drives N
# test windows with a distinctive xterm class, and tears everything down.
#
# --dry-run prints the exact sequence of commands a real run would execute,
# without executing any of them. Unit-04 uses only --dry-run; unit-05/unit-06
# invoke the non-dry-run mode.
#
# See harness/README.md for the design decisions and rationale.

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

LOG_DIR="/tmp/plasma-auto-tiler"
TEST_WINDOW_CLASS="PlasmaAutoTilerTestWindow"
XTERM_HOLD_SECONDS="3600"
SPAWN_SETTLE_SECONDS="0.5"
SETTLE_AFTER_SPAWN_SECONDS="2"
RSS_SETTLE_SECONDS="1"
SETTLE_AFTER_TEARDOWN_SECONDS="2"
DBUS_MONITOR_FILTER="type='method_call',interface='com.plasmaAutoTiler.LogSink'"
SINK_FIFO="$LOG_DIR/sink.fifo"
AMP_LOG_A="$LOG_DIR/variant-a-amplified.log"
AMP_LOG_B="$LOG_DIR/variant-b-amplified.log"
REQUIRED_TOOLS="xterm dbus-monitor awk kwriteconfig6 kreadconfig6 stdbuf setsid pgrep ps mkfifo qdbus sleep seq"

DRY_RUN=0
VARIANT=""
N=""

usage() {
    cat <<'EOF'
Usage: run.sh [--dry-run] --variant a|b -n <count>

Runs one baseline-measurement sweep for the given variant at the given
window count. --dry-run only prints the exact sequence of commands that a
real run would execute, without executing any of them.

Options:
  --variant a|b   variant to measure (plugin plasma-auto-tiler-variant-a/-b)
  -n, --count N   number of test windows to spawn (any positive integer)
  --dry-run       print the trace only; execute nothing
  -h, --help      show this help
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --variant) VARIANT="$2"; shift 2 ;;
        -n|--count) N="$2"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
    esac
done

case "$VARIANT" in
    a) PLUGIN_NAME="plasma-auto-tiler-variant-a"; SCRIPT_PATH="$BASE_DIR/script/variant-a.js"; REAL_LOG="$LOG_DIR/variant-a.log" ;;
    b) PLUGIN_NAME="plasma-auto-tiler-variant-b"; SCRIPT_PATH="$BASE_DIR/script/variant-b.js"; REAL_LOG="$LOG_DIR/variant-b.log" ;;
    *) echo "error: --variant must be 'a' or 'b'" >&2; usage >&2; exit 2 ;;
esac

if ! [[ "$N" =~ ^[1-9][0-9]*$ ]]; then
    echo "error: -n must be a positive integer" >&2; usage >&2; exit 2
fi

RSS_FILE="$LOG_DIR/rss-$VARIANT-$N.txt"
AMP_LOG="$LOG_DIR/variant-$VARIANT-amplified.log"

# The awk demux program. Reads the dbus-monitor textual stream from the FIFO
# and routes each LogSink line to the correct file by its first CSV field:
#   amplified-a -> variant-a-amplified.log
#   amplified-b -> variant-b-amplified.log
#   anything else (windowAdded/windowRemoved/watchdog-*) -> this variant's
#   real-dispatch log
# Every line is flushed immediately so no data is lost when the process is
# killed at teardown.
DEMUX_PROGRAM='{
    if (/interface=com.plasmaAutoTiler.LogSink; member=append/) {
        getline
        line = $0
        if (line !~ /^[ \t]*string "/) next
        sub(/^[ \t]*string "/, "", line)
        sub(/"$/, "", line)
        split(line, f, ",")
        if (f[1] == "amplified-a") print line >> ampa
        else if (f[1] == "amplified-b") print line >> ampb
        else print line >> reallog
        fflush()
    }
}'

say() { printf '%s\n' "$*"; }
cmd() { printf '    %s\n' "$*"; }
note() { printf '    # %s\n' "$*"; }
step() { printf '\n[Step %s] %s\n' "$1" "$2"; }

echo "=========================================================================="
echo "plasma-auto-tiler baseline sweep"
echo "  variant:             $VARIANT"
echo "  plugin name:         $PLUGIN_NAME"
echo "  script path:         $SCRIPT_PATH"
echo "  windows (N):         $N"
echo "  test-window class:   $TEST_WINDOW_CLASS"
echo "  real-dispatch log:   $REAL_LOG"
echo "  amplified log:       $AMP_LOG"
echo "  RSS samples file:    $RSS_FILE"
if [ "$DRY_RUN" -eq 1 ]; then
    echo "  mode:                DRY-RUN (nothing below is executed)"
else
    echo "  mode:                LIVE (commands below are executed)"
fi
echo "Config note: only managedResourceClass is written. amplify stays at its"
echo "  default \"0\" and watchdogMaxLifetimeMs at its default \"300000\";"
echo "  neither is written by this harness (amplification is a separate"
echo "  calibration pass out of this unit's scope)."
echo "=========================================================================="

# ---------------------------------------------------------------------------
step 1 "Pre-flight session checks (real mode aborts if any fails)"
# ---------------------------------------------------------------------------
cmd "command -v $REQUIRED_TOOLS"
note "real mode checks each tool resolves; aborts if any is missing"
cmd "qdbus org.kde.KWin /Scripting isScriptLoaded $PLUGIN_NAME"
note "expect false; if true, a previous run left the script loaded -> abort"
cmd "qdbus org.kde.KWin /KWin org.freedesktop.DBus.Peer.Ping"
note "expect exit 0; confirms kwin_wayland is responsive"
cmd "pgrep -f 'xterm -class $TEST_WINDOW_CLASS'"
note "expect no match; a match means a previous run leaked test windows -> abort"
cmd "pgrep -f 'dbus-monitor.*LogSink'"
note "expect no match; a match means a previous run left a capture running -> abort"
cmd "kreadconfig6 --file kwinrc --group Script-$PLUGIN_NAME --key amplify"
note "read-only sanity check; warn if it is not the default \"0\""
if [ "$DRY_RUN" -eq 0 ]; then
    for t in $REQUIRED_TOOLS; do
        if ! command -v "$t" >/dev/null 2>&1; then
            echo "error: required tool '$t' not found on PATH" >&2
            exit 1
        fi
    done
    if [ "$(qdbus org.kde.KWin /Scripting isScriptLoaded "$PLUGIN_NAME")" = "true" ]; then
        echo "error: $PLUGIN_NAME already loaded; a previous run was not cleaned up" >&2
        exit 1
    fi
    qdbus org.kde.KWin /KWin org.freedesktop.DBus.Peer.Ping >/dev/null
    if pgrep -f "xterm -class $TEST_WINDOW_CLASS" >/dev/null; then
        echo "error: leftover test windows from a previous run" >&2
        exit 1
    fi
    if pgrep -f "dbus-monitor.*LogSink" >/dev/null; then
        echo "error: leftover dbus-monitor capture from a previous run" >&2
        exit 1
    fi
    if [ "$(kreadconfig6 --file kwinrc --group "Script-$PLUGIN_NAME" --key amplify 2>/dev/null)" != "" ] \
            && [ "$(kreadconfig6 --file kwinrc --group "Script-$PLUGIN_NAME" --key amplify 2>/dev/null)" != "0" ]; then
        echo "warning: amplify is not at its default \"0\" for $PLUGIN_NAME; the main sweep" >&2
        echo "warning: should only be run with amplification off" >&2
    fi
fi

# ---------------------------------------------------------------------------
step 2 "Create the log directory and truncate the log files"
# ---------------------------------------------------------------------------
cmd "mkdir -p $LOG_DIR"
cmd ": > $REAL_LOG"
cmd ": > $AMP_LOG"
if [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$LOG_DIR"
    : > "$REAL_LOG"
    : > "$AMP_LOG"
fi

# ---------------------------------------------------------------------------
step 3 "Start the LogSink capture: dbus-monitor -> FIFO -> awk demux"
# ---------------------------------------------------------------------------
note "the method call is observable even though no service owns the reserved"
note "name (the bus monitors every message, as proven in the clock probe)"
cmd "rm -f $SINK_FIFO && mkfifo $SINK_FIFO"
cmd "stdbuf -oL dbus-monitor --session \"$DBUS_MONITOR_FILTER\" > $SINK_FIFO 2>/dev/null &"
cmd "MONITOR_PID=\$!"
cmd "awk -v reallog=$REAL_LOG -v ampa=$AMP_LOG_A -v ampb=$AMP_LOG_B '$DEMUX_PROGRAM' < $SINK_FIFO &"
cmd "DEMUX_PID=\$!"
note "stdbuf -oL line-buffers dbus-monitor so records reach awk immediately;"
note "awk fflush()es every line so nothing is buffered at teardown"
if [ "$DRY_RUN" -eq 0 ]; then
    rm -f "$SINK_FIFO"
    mkfifo "$SINK_FIFO"
    stdbuf -oL dbus-monitor --session "$DBUS_MONITOR_FILTER" > "$SINK_FIFO" 2>/dev/null &
    MONITOR_PID=$!
    awk -v reallog="$REAL_LOG" -v ampa="$AMP_LOG_A" -v ampb="$AMP_LOG_B" "$DEMUX_PROGRAM" < "$SINK_FIFO" &
    DEMUX_PID=$!
fi

# ---------------------------------------------------------------------------
step 4 "Baseline RSS sample (no script loaded)"
# ---------------------------------------------------------------------------
cmd "kwin_pid=\$(pgrep -f '[k]win_wayland --')"
note "pgrep -x kwin_wayland does not match on this host (comm is truncated to"
note ".kwin_wayland-w); '[k]win_wayland --' uniquely matches the real compositor"
note "process, not the kwin_wayland_wrapper (verified live, PID 2532)"
cmd "sleep $RSS_SETTLE_SECONDS"
cmd "ps -o rss= -p \"\$kwin_pid\""
note "record as baseline_no_script_kb (fresh sample per run, safe against drift)"
if [ "$DRY_RUN" -eq 0 ]; then
    kwin_pid="$(pgrep -f '[k]win_wayland --' || true)"
    if [ -z "$kwin_pid" ] || [ "$(printf '%s\n' "$kwin_pid" | wc -l)" -gt 1 ]; then
        echo "error: could not uniquely identify the kwin_wayland process" >&2
        exit 1
    fi
    sleep "$RSS_SETTLE_SECONDS"
    RSS_BASELINE="$(ps -o rss= -p "$kwin_pid")"
    echo "    baseline_no_script_kb=$RSS_BASELINE"
fi

# ---------------------------------------------------------------------------
step 5 "Write the terminal-protection scope config, then reconfigure"
# ---------------------------------------------------------------------------
cmd "kwriteconfig6 --file kwinrc --group Script-$PLUGIN_NAME --key managedResourceClass $TEST_WINDOW_CLASS"
cmd "qdbus org.kde.KWin /KWin reconfigure"
note "the class written here and the xterm -class below are the same literal"
note "string: $TEST_WINDOW_CLASS"
if [ "$DRY_RUN" -eq 0 ]; then
    kwriteconfig6 --file kwinrc --group "Script-$PLUGIN_NAME" --key managedResourceClass "$TEST_WINDOW_CLASS"
    qdbus org.kde.KWin /KWin reconfigure
fi

# ---------------------------------------------------------------------------
step 6 "Load the script, then start it (load-only does nothing)"
# ---------------------------------------------------------------------------
cmd "qdbus org.kde.KWin /Scripting loadScript $SCRIPT_PATH $PLUGIN_NAME"
cmd "qdbus org.kde.KWin /Scripting start"
note "both calls are required: loadScript only parses and registers; start"
note "runs the top-level code that connects the windowAdded handler"
if [ "$DRY_RUN" -eq 0 ]; then
    qdbus org.kde.KWin /Scripting loadScript "$SCRIPT_PATH" "$PLUGIN_NAME"
    qdbus org.kde.KWin /Scripting start
fi

# ---------------------------------------------------------------------------
step 7 "Verify the script is loaded"
# ---------------------------------------------------------------------------
cmd "qdbus org.kde.KWin /Scripting isScriptLoaded $PLUGIN_NAME"
note "expect true; abort if not"
if [ "$DRY_RUN" -eq 0 ]; then
    if [ "$(qdbus org.kde.KWin /Scripting isScriptLoaded "$PLUGIN_NAME")" != "true" ]; then
        echo "error: $PLUGIN_NAME did not load" >&2
        exit 1
    fi
    echo "    isScriptLoaded=$PLUGIN_NAME -> true"
fi

# ---------------------------------------------------------------------------
step 8 "RSS sample (script loaded, zero windows)"
# ---------------------------------------------------------------------------
cmd "sleep $RSS_SETTLE_SECONDS"
cmd "ps -o rss= -p \"\$kwin_pid\""
note "record as loaded_no_windows_kb; separates pure script-load cost from"
note "per-window growth (loaded_N - loaded_0)"
if [ "$DRY_RUN" -eq 0 ]; then
    sleep "$RSS_SETTLE_SECONDS"
    RSS_LOADED0="$(ps -o rss= -p "$kwin_pid")"
    echo "    loaded_no_windows_kb=$RSS_LOADED0"
fi

# ---------------------------------------------------------------------------
step 9 "Spawn N test windows"
# ---------------------------------------------------------------------------
note "each window: xterm -class $TEST_WINDOW_CLASS -e sleep $XTERM_HOLD_SECONDS"
note "(sleep holds the window open for a bounded $XTERM_HOLD_SECONDS s; it is"
note "killed at teardown). setsid puts each xterm in its own process group so"
note "teardown can kill the window and its sleep child together."
for i in $(seq 1 "$N"); do
    cmd "setsid xterm -class $TEST_WINDOW_CLASS -e sleep $XTERM_HOLD_SECONDS >/dev/null 2>&1 &"
done
cmd "sleep $SPAWN_SETTLE_SECONDS  (after each of the $N spawns)"
cmd "sleep $SETTLE_AFTER_SPAWN_SECONDS  (after the last spawn)"
note "0.5 s between spawns lets KWin placement and the script's handler complete"
note "before the next window, so the per-event distribution is not distorted by"
note "burst contention and Variant B's model grows deterministically"
if [ "$DRY_RUN" -eq 0 ]; then
    pids=()
    for i in $(seq 1 "$N"); do
        setsid xterm -class "$TEST_WINDOW_CLASS" -e sleep "$XTERM_HOLD_SECONDS" >/dev/null 2>&1 &
        pids+=("$!")
        sleep "$SPAWN_SETTLE_SECONDS"
    done
    sleep "$SETTLE_AFTER_SPAWN_SECONDS"
fi

# ---------------------------------------------------------------------------
step 10 "RSS sample (script loaded, N windows present)"
# ---------------------------------------------------------------------------
cmd "sleep $RSS_SETTLE_SECONDS"
cmd "ps -o rss= -p \"\$kwin_pid\""
note "record as loaded_${N}_windows_kb"
note "tier RSS delta = loaded_${N}_windows_kb - baseline_no_script_kb"
if [ "$DRY_RUN" -eq 0 ]; then
    sleep "$RSS_SETTLE_SECONDS"
    RSS_LOADEDN="$(ps -o rss= -p "$kwin_pid")"
    echo "    loaded_${N}_windows_kb=$RSS_LOADEDN"
fi

# ---------------------------------------------------------------------------
step 11 "Tear down the test windows and verify none leak"
# ---------------------------------------------------------------------------
note "kill each spawned process group (xterm + its sleep child); this is what"
note "drives Variant B's windowRemoved reconciliation, measured per removal"
cmd "kill -- -\$pid  (for each spawned pid)"
cmd "sleep $SETTLE_AFTER_TEARDOWN_SECONDS  (let windowRemoved lines flush)"
cmd "pgrep -f 'xterm -class $TEST_WINDOW_CLASS'"
note "expect no match; warn if any test window leaked"
if [ "$DRY_RUN" -eq 0 ]; then
    for pid in "${pids[@]}"; do
        kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    done
    sleep "$SETTLE_AFTER_TEARDOWN_SECONDS"
    if pgrep -f "xterm -class $TEST_WINDOW_CLASS" >/dev/null; then
        echo "warning: test windows matching $TEST_WINDOW_CLASS still present after teardown" >&2
    else
        echo "    no test windows remain"
    fi
fi

# ---------------------------------------------------------------------------
step 12 "Unload the script and verify it is gone"
# ---------------------------------------------------------------------------
cmd "qdbus org.kde.KWin /Scripting unloadScript $PLUGIN_NAME"
cmd "qdbus org.kde.KWin /Scripting isScriptLoaded $PLUGIN_NAME"
note "expect false"
if [ "$DRY_RUN" -eq 0 ]; then
    qdbus org.kde.KWin /Scripting unloadScript "$PLUGIN_NAME"
    if [ "$(qdbus org.kde.KWin /Scripting isScriptLoaded "$PLUGIN_NAME")" != "false" ]; then
        echo "error: $PLUGIN_NAME did not unload" >&2
        exit 1
    fi
    echo "    isScriptLoaded=$PLUGIN_NAME -> false"
fi

# ---------------------------------------------------------------------------
step 13 "Stop the dbus-monitor capture"
# ---------------------------------------------------------------------------
cmd "kill \$DEMUX_PID \$MONITOR_PID 2>/dev/null"
cmd "rm -f $SINK_FIFO"
if [ "$DRY_RUN" -eq 0 ]; then
    kill "$DEMUX_PID" "$MONITOR_PID" 2>/dev/null || true
    rm -f "$SINK_FIFO"
fi

# ---------------------------------------------------------------------------
step 14 "Verify kwin_wayland still responds"
# ---------------------------------------------------------------------------
cmd "qdbus org.kde.KWin /KWin org.freedesktop.DBus.Peer.Ping"
note "expect exit 0"
if [ "$DRY_RUN" -eq 0 ]; then
    qdbus org.kde.KWin /KWin org.freedesktop.DBus.Peer.Ping
    echo "    kwin_wayland Ping -> ok"
fi

# ---------------------------------------------------------------------------
step 15 "Persist RSS samples and report output locations"
# ---------------------------------------------------------------------------
cmd "printf '%s\\n' \"# variant=$VARIANT n=$N run=<utc-timestamp>\" \\"
cmd "  \"baseline_no_script_kb=<sample>\" \"loaded_no_windows_kb=<sample>\" \\"
cmd "  \"loaded_${N}_windows_kb=<sample>\" \"tier_delta_kb=<loaded_N - baseline>\" > $RSS_FILE"
if [ "$DRY_RUN" -eq 0 ]; then
    {
        echo "# variant=$VARIANT n=$N run=$(date -u +%FT%TZ)"
        echo "baseline_no_script_kb=$RSS_BASELINE"
        echo "loaded_no_windows_kb=$RSS_LOADED0"
        echo "loaded_${N}_windows_kb=$RSS_LOADEDN"
        echo "tier_delta_kb=$(( RSS_LOADEDN - RSS_BASELINE ))"
    } > "$RSS_FILE"
    echo "    wrote $RSS_FILE"
fi

echo
echo "=========================================================================="
echo "Outputs:"
echo "  real-dispatch log:   $REAL_LOG"
echo "  amplified log:       $AMP_LOG (expected empty; amplify off)"
echo "  RSS samples file:    $RSS_FILE"
if [ "$DRY_RUN" -eq 0 ]; then
    echo "  tier RSS delta:      $(( RSS_LOADEDN - RSS_BASELINE )) KB"
fi
echo "=========================================================================="
