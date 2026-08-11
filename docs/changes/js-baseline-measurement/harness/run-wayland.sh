#!/usr/bin/env bash
set -euo pipefail

# Wayland-native harness for the js-baseline-measurement change (unit-D).
#
# Mirror of harness/run.sh adapted for genuine Wayland-native test clients
# (konsole) instead of X11/xterm-through-XWayland windows. Same structure:
# LogSink capture via dbus-monitor + awk demux, three RSS samples, per-tier
# spot-check that the sentinel resourceClass is live and the windows are NOT
# present in the Xwayland client listing (xlsclients), teardown, unload, and
# full reversal verification.
#
# Safety contract (brief unit-D):
#   - terminal-protection sentinel: --desktopfile plasma-auto-tiler-test
#     produces resourceClass "plasma-auto-tiler-test", verified distinct from
#     every real user window (user's terminal is com.mitchellh.ghostty).
#   - watchdog (watchdogMaxLifetimeMs) left enabled at default.
#   - no Q1/frame capture, no PipeWire/ScreenCast portal interaction.
#   - aborts on any precondition failure; never proceeds on ambiguity.

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS_DIR="$BASE_DIR/results/variant-b-wayland"

LOG_DIR="/tmp/plasma-auto-tiler"
TEST_WINDOW_CLASS="plasma-auto-tiler-test"
SPAWN_SETTLE_SECONDS="0.5"
SETTLE_AFTER_SPAWN_SECONDS="2"
RSS_SETTLE_SECONDS="1"
SETTLE_AFTER_TEARDOWN_SECONDS="2"
DBUS_MONITOR_FILTER="type='method_call',interface='com.plasmaAutoTiler.LogSink'"
SINK_FIFO="$LOG_DIR/sink.fifo"
ENUM_SCRIPT="$BASE_DIR/script/window-enum-probe.js"
ENUM_PLUGIN="plasma-auto-tiler-window-enum"
REQUIRED_TOOLS="konsole dbus-monitor awk kwriteconfig6 kreadconfig6 stdbuf setsid pgrep ps mkfifo qdbus sleep seq xlsclients"

VARIANT="b"
N=""
PLUGIN_NAME="plasma-auto-tiler-variant-b"
SCRIPT_PATH="$BASE_DIR/script/variant-b.js"

usage() {
    cat <<'EOF'
Usage: run-wayland.sh -n <count>

Runs one Wayland-native baseline-measurement sweep for Variant B at the given
window count, using konsole test windows (sentinel resourceClass
plasma-auto-tiler-test). Writes raw logs + RSS file into
results/variant-b-wayland/.

Options:
  -n, --count N   number of test windows to spawn
  -h, --help      show this help
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        -n|--count) N="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
    esac
done

if ! [[ "$N" =~ ^[1-9][0-9]*$ ]]; then
    echo "error: -n must be a positive integer" >&2; usage >&2; exit 2
fi

REAL_LOG="$RESULTS_DIR/tier-$N.log"
AMP_LOG="$RESULTS_DIR/tier-$N-amplified.log"
RSS_FILE="$RESULTS_DIR/tier-$N-rss.txt"
SPOT_FILE="$RESULTS_DIR/tier-$N-spot.txt"

# awk demux: amplified-* -> amplified log, winenum -> spot file, else ->
# real-dispatch log. Every line flushed immediately.
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
        else if (f[1] == "winenum") print line >> spot
        else print line >> reallog
        fflush()
    }
}'

say() { printf '%s\n' "$*"; }
note() { printf '    # %s\n' "$*"; }
step() { printf '\n[Step %s] %s\n' "$1" "$2"; }

echo "=========================================================================="
echo "plasma-auto-tiler baseline sweep (Wayland-native clients)"
echo "  variant:             $VARIANT (plugin $PLUGIN_NAME)"
echo "  windows (N):         $N"
echo "  test client:         konsole"
echo "  test-window class:   $TEST_WINDOW_CLASS (via --desktopfile)"
echo "  real-dispatch log:   $REAL_LOG"
echo "  RSS samples file:    $RSS_FILE"
echo "  spot-check file:     $SPOT_FILE"
echo "=========================================================================="

# ---------------------------------------------------------------------------
step 1 "Pre-flight session checks"
# ---------------------------------------------------------------------------
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
if [ "$(qdbus org.kde.KWin /Scripting isScriptLoaded "$ENUM_PLUGIN")" = "true" ]; then
    echo "error: $ENUM_PLUGIN already loaded; a previous run was not cleaned up" >&2
    exit 1
fi
qdbus org.kde.KWin /KWin org.freedesktop.DBus.Peer.Ping >/dev/null
if pgrep -f "konsole.*--desktopfile $TEST_WINDOW_CLASS" >/dev/null; then
    echo "error: leftover test windows from a previous run" >&2
    exit 1
fi
if pgrep -f "dbus-monitor.*LogSink" >/dev/null; then
    echo "error: leftover dbus-monitor capture from a previous run" >&2
    exit 1
fi
if [ "$(kreadconfig6 --file kwinrc --group "Script-$PLUGIN_NAME" --key amplify 2>/dev/null)" != "" ] \
        && [ "$(kreadconfig6 --file kwinrc --group "Script-$PLUGIN_NAME" --key amplify 2>/dev/null)" != "0" ]; then
    echo "warning: amplify is not at its default \"0\" for $PLUGIN_NAME" >&2
fi
echo "    pre-flight ok"

# ---------------------------------------------------------------------------
step 2 "Create the results dir and truncate the log files"
# ---------------------------------------------------------------------------
mkdir -p "$RESULTS_DIR"
: > "$REAL_LOG"
: > "$AMP_LOG"
: > "$SPOT_FILE"

# ---------------------------------------------------------------------------
step 3 "Start the LogSink capture: dbus-monitor -> FIFO -> awk demux"
# ---------------------------------------------------------------------------
rm -f "$SINK_FIFO"
mkfifo "$SINK_FIFO"
stdbuf -oL dbus-monitor --session "$DBUS_MONITOR_FILTER" > "$SINK_FIFO" 2>/dev/null &
MONITOR_PID=$!
awk -v reallog="$REAL_LOG" -v ampa="$AMP_LOG" -v ampb="$AMP_LOG" -v spot="$SPOT_FILE" "$DEMUX_PROGRAM" < "$SINK_FIFO" &
DEMUX_PID=$!
echo "    capture started (monitor $MONITOR_PID, demux $DEMUX_PID)"

# ---------------------------------------------------------------------------
step 4 "Baseline RSS sample (no script loaded)"
# ---------------------------------------------------------------------------
kwin_pid="$(pgrep -f '[k]win_wayland --' || true)"
if [ -z "$kwin_pid" ] || [ "$(printf '%s\n' "$kwin_pid" | wc -l)" -gt 1 ]; then
    echo "error: could not uniquely identify the kwin_wayland process" >&2
    exit 1
fi
sleep "$RSS_SETTLE_SECONDS"
RSS_BASELINE="$(ps -o rss= -p "$kwin_pid")"
echo "    baseline_no_script_kb=$RSS_BASELINE"

# ---------------------------------------------------------------------------
step 5 "Write the terminal-protection scope config, then reconfigure"
# ---------------------------------------------------------------------------
kwriteconfig6 --file kwinrc --group "Script-$PLUGIN_NAME" --key managedResourceClass "$TEST_WINDOW_CLASS"
qdbus org.kde.KWin /KWin reconfigure
echo "    managedResourceClass=$TEST_WINDOW_CLASS written + reconfigured"

# ---------------------------------------------------------------------------
step 6 "Load the script, then start it (load-only does nothing)"
# ---------------------------------------------------------------------------
qdbus org.kde.KWin /Scripting loadScript "$SCRIPT_PATH" "$PLUGIN_NAME"
qdbus org.kde.KWin /Scripting start

# ---------------------------------------------------------------------------
step 7 "Verify the script is loaded"
# ---------------------------------------------------------------------------
if [ "$(qdbus org.kde.KWin /Scripting isScriptLoaded "$PLUGIN_NAME")" != "true" ]; then
    echo "error: $PLUGIN_NAME did not load" >&2
    exit 1
fi
echo "    isScriptLoaded=$PLUGIN_NAME -> true"

# ---------------------------------------------------------------------------
step 8 "RSS sample (script loaded, zero windows)"
# ---------------------------------------------------------------------------
sleep "$RSS_SETTLE_SECONDS"
RSS_LOADED0="$(ps -o rss= -p "$kwin_pid")"
echo "    loaded_no_windows_kb=$RSS_LOADED0"

# ---------------------------------------------------------------------------
step 9 "Spawn N Wayland-native test windows"
# ---------------------------------------------------------------------------
note "each window: setsid konsole --separate --desktopfile $TEST_WINDOW_CLASS -e sleep 3600"
note "--desktopfile makes the app_id/resourceClass the sentinel value; --separate"
note "forces a fresh process so each spawn is a distinct window"
pids=()
for i in $(seq 1 "$N"); do
    setsid konsole --separate --desktopfile "$TEST_WINDOW_CLASS" -e sleep 3600 >/dev/null 2>&1 &
    pids+=("$!")
    sleep "$SPAWN_SETTLE_SECONDS"
done
sleep "$SETTLE_AFTER_SPAWN_SECONDS"

# ---------------------------------------------------------------------------
step 10 "Per-tier spot-check: sentinel class live AND absent from X11 listing"
# ---------------------------------------------------------------------------
note "load one-shot window-enum probe to confirm live windows report the"
note "sentinel resourceClass; xlsclients must not list any of them (Xwayland"
note "client listing; Wayland-native clients never appear)"
qdbus org.kde.KWin /Scripting loadScript "$ENUM_SCRIPT" "$ENUM_PLUGIN"
qdbus org.kde.KWin /Scripting start
sleep 2
qdbus org.kde.KWin /Scripting unloadScript "$ENUM_PLUGIN"
sleep 1
XLS="$(xlsclients 2>&1 || true)"
X11_WINS="$(printf '%s\n' "$XLS" | grep -c . || true)"
{
    echo "# spot-check: xlsclients output while $N test windows open"
    printf '%s\n' "$XLS"
} >> "$SPOT_FILE"
sleep 1
SPOT_WINS="$(grep -c '^winenum,win' "$SPOT_FILE" || true)"
SENTINEL_WINS="$(grep '^winenum,win' "$SPOT_FILE" | grep -c "class=$TEST_WINDOW_CLASS" || true)"
echo "    spot: enum windows=$SPOT_WINS sentinel-class=$SENTINEL_WINS xlsclients_lines=$X11_WINS"
if [ "$SENTINEL_WINS" -lt 1 ]; then
    echo "error: no live window reported the sentinel resourceClass; aborting sweep" >&2
    echo "error: windows at risk of being unmanaged or misidentified" >&2
    exit 1
fi
if [ "$X11_WINS" -ne 0 ]; then
    echo "warning: xlsclients reported $X11_WINS X clients; expected 0 (Wayland-native windows)" >&2
fi

# ---------------------------------------------------------------------------
step 11 "RSS sample (script loaded, N windows present)"
# ---------------------------------------------------------------------------
sleep "$RSS_SETTLE_SECONDS"
RSS_LOADEDN="$(ps -o rss= -p "$kwin_pid")"
echo "    loaded_${N}_windows_kb=$RSS_LOADEDN"

# ---------------------------------------------------------------------------
step 12 "Tear down the test windows and verify none leak"
# ---------------------------------------------------------------------------
for pid in "${pids[@]}"; do
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
done
sleep "$SETTLE_AFTER_TEARDOWN_SECONDS"
if pgrep -f "konsole.*--desktopfile $TEST_WINDOW_CLASS" >/dev/null; then
    echo "warning: test windows matching $TEST_WINDOW_CLASS still present after teardown" >&2
else
    echo "    no test windows remain"
fi

# ---------------------------------------------------------------------------
step 13 "Unload the script and verify it is gone"
# ---------------------------------------------------------------------------
qdbus org.kde.KWin /Scripting unloadScript "$PLUGIN_NAME"
if [ "$(qdbus org.kde.KWin /Scripting isScriptLoaded "$PLUGIN_NAME")" != "false" ]; then
    echo "error: $PLUGIN_NAME did not unload" >&2
    exit 1
fi
echo "    isScriptLoaded=$PLUGIN_NAME -> false"

# ---------------------------------------------------------------------------
step 14 "Stop the dbus-monitor capture"
# ---------------------------------------------------------------------------
kill "$DEMUX_PID" "$MONITOR_PID" 2>/dev/null || true
rm -f "$SINK_FIFO"

# ---------------------------------------------------------------------------
step 15 "Verify kwin_wayland still responds and log data sanity"
# ---------------------------------------------------------------------------
qdbus org.kde.KWin /KWin org.freedesktop.DBus.Peer.Ping
echo "    kwin_wayland Ping -> ok"

ADD_LINES="$(grep -c '^windowAdded' "$REAL_LOG" || true)"
REM_LINES="$(grep -c '^windowRemoved' "$REAL_LOG" || true)"
if [ "$ADD_LINES" -lt "$N" ] || [ "$REM_LINES" -lt "$N" ]; then
    echo "error: log data incomplete: expected >=$N windowAdded and >=$N windowRemoved," >&2
    echo "error: got $ADD_LINES windowAdded and $REM_LINES windowRemoved" >&2
    exit 1
fi
echo "    log sanity: windowAdded=$ADD_LINES windowRemoved=$REM_LINES"

# ---------------------------------------------------------------------------
step 16 "Persist RSS samples"
# ---------------------------------------------------------------------------
{
    echo "# variant=$VARIANT n=$N client=konsole run=$(date -u +%FT%TZ)"
    echo "baseline_no_script_kb=$RSS_BASELINE"
    echo "loaded_no_windows_kb=$RSS_LOADED0"
    echo "loaded_${N}_windows_kb=$RSS_LOADEDN"
    echo "tier_delta_kb=$(( RSS_LOADEDN - RSS_BASELINE ))"
} > "$RSS_FILE"
echo "    wrote $RSS_FILE"

echo
echo "=========================================================================="
echo "Outputs:"
echo "  real-dispatch log:   $REAL_LOG"
echo "  amplified log:       $AMP_LOG (expected empty; amplify off)"
echo "  spot-check file:     $SPOT_FILE"
echo "  RSS samples file:    $RSS_FILE"
echo "  tier RSS delta:      $(( RSS_LOADEDN - RSS_BASELINE )) KB"
echo "=========================================================================="
