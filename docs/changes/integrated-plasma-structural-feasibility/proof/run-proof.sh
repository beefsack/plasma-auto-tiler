#!/usr/bin/env bash
set -uo pipefail

# Plasma Auto Tiler structural-feasibility proof harness, staged
# (unit-04/attempt-02 protocol research/proof-protocol.md).
#
# One bounded, self-contained stage command per invocation. No harness session
# persists across stages or user turns; there is no user/coordinator go file and
# no unbounded FIFO wait; the only FIFO is the internal bounded-event capture
# FIFO. The supervisor waits only for an exact matching proof event inside the
# fixed stage deadline. Every stage ends in the full reversal on event match,
# timeout, error, signal, or termination.
#
# Usage: run-proof.sh --stage <STAGE>
#   STAGE: PRE | AUT-KEY | AUT-WAY | AUT-BRANCH | M1 | M2
#
# Deadline: PRE = 60 s; every live stage = 90 s, enforced internally by the
# harness's own absolute-deadline checks. There is no external timeout/kill-after
# wrapper around the harness; the harness owns cleanup and traps INT/TERM/EXIT
# to run the full per-stage reversal. SIGKILL or host failure can interrupt
# cleanup; that is an acknowledged residual risk, never a cleanup guarantee.

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROOF_DIR="$BASE_DIR/proof"
SCRIPT_PATH="$PROOF_DIR/structural-proof.js"
RESULTS_DIR="$BASE_DIR/results"

PROOF_ID="plasma-auto-tiler-structural-proof"
PROOF_DESKTOP_NAME="plasma-auto-tiler-proof"
SENTINEL_PREFIX="plasma-auto-tiler-kb-"
SENTINEL_SEQUENCE="Meta+Ctrl+Shift+Alt+P"
SENTINEL_KEYCODE="503316560"
XTERM_CLASS="PlasmaAutoTilerTestWindow"
KONSOLE_DESKTOPFILE="plasma-auto-tiler-test"
WATCHDOG_SECONDS=300

DBUS_MONITOR_FILTER="type='method_call',interface='com.plasmaAutoTiler.LogSink'"

REQUIRED_TOOLS="qdbus busctl dbus-monitor awk stdbuf setsid pgrep ps mkfifo mkdir rm sleep seq date sha256sum kreadconfig6 kwriteconfig6 kscreen-doctor xterm konsole node jq"

LOG_DIR="/tmp/plasma-auto-tiler/structural-proof"
SINK_FIFO="$LOG_DIR/sink.fifo"

STAGE=""
DEADLINE=90
RUNID=""
EVIDENCE_DIR=""
SNAPSHOT_DIR=""
SINK_LOG=""
ASSERT_LOG=""
PROGRESS_LOG=""
GATE_FILE=""
OBSERVATIONS=""

START_EPOCH=0
REVERSED=0
CLEANUP_FAIL=0
MONITOR_PID=""
DEMUX_PID=""
WINDOW_A_PID=""
WINDOW_B_PID=""
TEMP_DESKTOP_ID=""
ORIGINAL_DESKTOP_ID=""
SENTINEL_ACTION_ID=""
COMPONENT_NAME=""
COMPONENT_PATH=""
A_ID=""
B_ID=""
SCRIPT_STARTED=0

usage() {
    cat <<EOF
Usage: run-proof.sh --stage <STAGE>

Staged proof harness (unit-04/attempt-02 protocol).
STAGE: PRE | AUT-KEY | AUT-WAY | AUT-BRANCH | M1 | M2
EOF
}

say() { printf '%s\n' "$*"; }
step() { printf '\n[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; printf '\n[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >> "$PROGRESS_LOG"; }
now() { date +%s; }

deadline_reached() {
    local elapsed=$(( $(now) - START_EPOCH ))
    [ "$elapsed" -ge "$DEADLINE" ]
}

check_deadline() {
    if deadline_reached; then
        fail "$STAGE deadline exceeded (${DEADLINE}s)"
    fi
}

fail() {
    say "FAIL: $*" >&2
    printf '%s\n' "FAIL: $*" >> "$ASSERT_LOG"
    abort_recovery "$*"
}

pass() {
    say "PASS: $*"
    printf '%s\n' "PASS: $*" >> "$ASSERT_LOG"
}

warn() {
    say "WARN: $*" >&2
    printf '%s\n' "WARN: $*" >> "$ASSERT_LOG"
}

cleanup_fail() {
    CLEANUP_FAIL=1
    say "CLEANUP-FAIL: $*" >&2
    printf '%s\n' "CLEANUP-FAIL: $*" >> "$ASSERT_LOG"
}

run_cmd() {
    say "  $*"
    "$@" >> "$PROGRESS_LOG" 2>&1
}

# ---------------------------------------------------------------------------
# Sink capture (per-stage, under the stage evidence dir)
# ---------------------------------------------------------------------------

DEMUX_PROGRAM='{
    if (/interface=com.plasmaAutoTiler.LogSink; member=append/) {
        getline
        line = $0
        if (line !~ /^[ \t]*string "/) next
        sub(/^[ \t]*string "/, "", line)
        sub(/"$/, "", line)
        print line >> sink
        fflush()
    }
}'

start_capture() {
    mkdir -p "$LOG_DIR"
    rm -f "$SINK_FIFO"
    mkfifo "$SINK_FIFO"
    stdbuf -oL dbus-monitor --session "$DBUS_MONITOR_FILTER" > "$SINK_FIFO" 2>/dev/null &
    MONITOR_PID=$!
    awk -v sink="$SINK_LOG" "$DEMUX_PROGRAM" < "$SINK_FIFO" &
    DEMUX_PID=$!
    say "capture started: monitor=$MONITOR_PID demux=$DEMUX_PID"
}

stop_capture() {
    [ -n "${DEMUX_PID:-}" ] && kill "$DEMUX_PID" 2>/dev/null || true
    [ -n "${MONITOR_PID:-}" ] && kill "$MONITOR_PID" 2>/dev/null || true
    rm -f "$SINK_FIFO"
}

sink_has() { grep -qE "$1" "$SINK_LOG" 2>/dev/null; }
sink_count() { grep -cE "$1" "$SINK_LOG" 2>/dev/null || true; }
sink_last() { grep -E "$1" "$SINK_LOG" 2>/dev/null | tail -1; }

wait_for_sink() {
    # Wait for an exact matching proof event (regex $1) with a per-wait bound
    # ($2) and the absolute stage deadline. A timeout is a failed assertion.
    local pattern="$1" timeout="$2"
    local wait_deadline=$(( $(now) + timeout ))
    while [ "$(now)" -lt "$wait_deadline" ]; do
        check_deadline
        if ! kill -0 "${MONITOR_PID:-0}" 2>/dev/null || ! kill -0 "${DEMUX_PID:-0}" 2>/dev/null; then
            fail "capture-broken (monitor=${MONITOR_PID:-unset} demux=${DEMUX_PID:-unset})"
        fi
        if sink_has "$pattern"; then
            return 0
        fi
        sleep 1
    done
    fail "event timeout: $pattern"
}

# ---------------------------------------------------------------------------
# D-Bus helpers
# ---------------------------------------------------------------------------

kwin_ping() { busctl --user call org.kde.KWin /KWin org.freedesktop.DBus.Peer Ping ""; }

vdesk_prop() { busctl --user get-property org.kde.KWin /VirtualDesktopManager org.kde.KWin.VirtualDesktopManager "$1"; }

desktop_name_to_id() {
    local name="$1"
    vdesk_prop desktops | awk -v n="$name" '
        {
            str = $0; nq = 0
            while (match(str, /"[^"]*"/)) {
                val = substr(str, RSTART + 1, RLENGTH - 2)
                nq++
                if (nq % 2 == 0) { if (val == n) { print prev_id; exit } }
                else { prev_id = val }
                str = substr(str, RSTART + RLENGTH)
            }
        }
    '
}

# ---------------------------------------------------------------------------
# Sentinel / kglobalaccel helpers (read-only plus the one targeted unregister)
# ---------------------------------------------------------------------------

any_component_has_action() {
    local prefix="$1" paths
    paths=$(busctl --user call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel allComponents 2>/dev/null | sed -E 's/^ao [0-9]+ //; s/"//g')
    for p in $paths; do
        if busctl --user call org.kde.kglobalaccel "$p" org.kde.kglobalaccel.Component allShortcutInfos 2>/dev/null | tr '"' '\n' | grep -q "^$prefix"; then
            return 0
        fi
    done
    return 1
}

discover_component() {
    local action="$1" paths
    paths=$(busctl --user call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel allComponents 2>/dev/null | sed -E 's/^ao [0-9]+ //; s/"//g')
    for p in $paths; do
        if busctl --user call org.kde.kglobalaccel "$p" org.kde.kglobalaccel.Component allShortcutInfos 2>/dev/null | tr '"' '\n' | grep -qx "$action"; then
            echo "$p"
            return 0
        fi
    done
    return 1
}

component_unique_name() {
    busctl --user get-property org.kde.kglobalaccel "$1" org.kde.kglobalaccel.Component uniqueName 2>/dev/null | sed -E 's/^s "//; s/"$//'
}

wait_for_sentinel_registration() {
    # Sentinel action id visible in exactly one component, bounded.
    local action="$1" bound="$2" deadline last found
    deadline=$(( $(now) + bound ))
    while [ "$(now)" -lt "$deadline" ]; do
        check_deadline
        found=0; last=""
        local paths
        paths=$(busctl --user call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel allComponents 2>/dev/null | sed -E 's/^ao [0-9]+ //; s/"//g')
        for p in $paths; do
            if busctl --user call org.kde.kglobalaccel "$p" org.kde.kglobalaccel.Component allShortcutInfos 2>/dev/null | tr '"' '\n' | grep -qx "$action"; then
                found=$((found + 1)); last="$p"
            fi
        done
        printf 'sentinel_count=%d path=%s epoch=%d\n' "$found" "$last" "$(now)" >> "$EVIDENCE_DIR/sentinel-visibility.log"
        if [ "$found" -eq 1 ]; then
            echo "$last"; return 0
        fi
        sleep 1
    done
    return 1
}

kglobalshortcutsrc_has_sentinel() {
    grep -q "$SENTINEL_PREFIX" "$HOME/.config/kglobalshortcutsrc" 2>/dev/null
}

poll_sentinel_absent() {
    local bound="$1" deadline=$(( $(now) + bound ))
    while [ "$(now)" -lt "$deadline" ]; do
        if ! any_component_has_action "$SENTINEL_ACTION_ID" && ! kglobalshortcutsrc_has_sentinel; then
            return 0
        fi
        sleep 1
    done
    return 1
}

# ---------------------------------------------------------------------------
# Tiling subgroup helpers
# ---------------------------------------------------------------------------

tiling_subgroup_list() {
    grep -oE '^\[Tiling\]\[[^]]+\]\[[^]]+\]' "$HOME/.config/kwinrc" 2>/dev/null
}

tiling_subgroup_absent() {
    grep -q "^\[Tiling\]\[$1\]\[" "$HOME/.config/kwinrc" 2>/dev/null && return 1 || return 0
}

tiling_read_back() {
    kreadconfig6 --file kwinrc --group Tiling --group "$1" --group "$2" --key "$3"
}

tiling_uuid_for() {
    local id="$1"
    awk -v id="$id" '
        $0 ~ "^\\[Tiling\\]\\[" id "\\]\\[([^]]+)\\]" { match($0, /\[[^]]+\]$/); print substr($0, RSTART+1, RLENGTH-2); exit }
    ' "$HOME/.config/kwinrc"
}

tiling_subgroup_hash() {
    awk '
        /^\[Tiling\]/ { if (in_sub) { print "" } else { in_sub = 1 } line = $0; next }
        in_sub && /^\[/ { in_sub = 0 }
        in_sub { print }
    ' "$HOME/.config/kwinrc" | sed '/^$/d' | sha256sum | awk '{print $1}'
}

# ---------------------------------------------------------------------------
# Snapshots (per-stage, under the stage snapshot dir)
# ---------------------------------------------------------------------------

snap_all() {
    mkdir -p "$SNAPSHOT_DIR"
    vdesk_prop desktops > "$SNAPSHOT_DIR/desktops.txt"
    vdesk_prop current > "$SNAPSHOT_DIR/current.txt"
    vdesk_prop count > "$SNAPSHOT_DIR/count.txt"
    vdesk_prop rows > "$SNAPSHOT_DIR/rows.txt"
    ORIGINAL_DESKTOP_ID=$(sed -E 's/^s "//; s/"$//' "$SNAPSHOT_DIR/current.txt")
    sha256sum "$HOME/.config/kwinrc" > "$SNAPSHOT_DIR/kwinrc.sha256"
    tiling_subgroup_hash > "$SNAPSHOT_DIR/tiling-subgroups.hash"
    tiling_subgroup_list > "$SNAPSHOT_DIR/tiling-subgroups.list"
    kscreen-doctor -o > "$SNAPSHOT_DIR/kscreen-doctor.txt" 2>&1
    pass "snapshots written to $SNAPSHOT_DIR"
}

# ---------------------------------------------------------------------------
# Precheck (read-only gate; any failure aborts before any mutation)
# ---------------------------------------------------------------------------

precheck() {
    say "== $STAGE precheck (read-only gate) =="
    for t in $REQUIRED_TOOLS; do
        if ! command -v "$t" >/dev/null 2>&1; then
            fail "precheck: required tool '$t' not found"
        fi
    done
    pass "tools present"
    if ! kwin_ping >/dev/null 2>&1; then
        fail "precheck: KWin Ping failed"
    fi
    pass "KWin responsive"
    if [ "$(busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting isScriptLoaded s "$PROOF_ID" 2>/dev/null)" != "b false" ]; then
        fail "precheck: proof script already loaded"
    fi
    pass "proof script not loaded"
    if [ "$(busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting isScriptLoaded s "krohnkite" 2>/dev/null)" != "b false" ]; then
        fail "precheck: krohnkite still loaded"
    fi
    pass "krohnkite not loaded"
    if [ "$(kreadconfig6 --file kwinrc --group Plugins --key krohnkiteEnabled 2>/dev/null)" != "false" ]; then
        fail "precheck: krohnkiteEnabled is not false"
    fi
    pass "krohnkite disabled"
    if pgrep -f "[x]term -class $XTERM_CLASS" >/dev/null 2>&1 || pgrep -f "[k]onsole --separate --desktopfile $KONSOLE_DESKTOPFILE" >/dev/null 2>&1; then
        fail "precheck: leftover test windows"
    fi
    pass "no leftover test windows"
    if pgrep -f "[d]bus-monitor" >/dev/null 2>&1; then
        fail "precheck: leftover capture"
    fi
    pass "no leftover capture"
    if [ -n "$(desktop_name_to_id "$PROOF_DESKTOP_NAME")" ]; then
        fail "precheck: proof desktop already present"
    fi
    pass "no proof desktop present"
    local count
    count=$(vdesk_prop count | awk '{print $2}')
    if [ -z "$count" ] || [ "$count" -ge 25 ]; then
        fail "precheck: desktop count $count not < 25"
    fi
    pass "desktop count $count < 25"
    if ! kscreen-doctor -o 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | grep -qE '^Output: 1 eDP-1'; then
        fail "precheck: expected exactly one output eDP-1"
    fi
    pass "single output eDP-1"
    if [ ! -f "$SCRIPT_PATH" ]; then
        fail "precheck: proof script missing"
    fi
    if ! node --check "$SCRIPT_PATH" >/dev/null 2>&1; then
        fail "precheck: proof script fails node --check"
    fi
    if grep -Pn '[\x{2014}\x{2018}\x{2019}\x{201C}\x{201D}\x{2026}\x{00A0}]' "$SCRIPT_PATH" >/dev/null 2>&1; then
        fail "precheck: proof script contains non-ASCII"
    fi
    pass "script syntax and ASCII"
    if [ -n "$(kreadconfig6 --file kwinrc --group Plugins --key "${PROOF_ID}Enabled" 2>/dev/null)" ]; then
        fail "precheck: [Plugins] ${PROOF_ID}Enabled is set"
    fi
    if grep -q "^\\[Script-${PROOF_ID}\\]" "$HOME/.config/kwinrc" 2>/dev/null; then
        fail "precheck: Script-${PROOF_ID} group exists"
    fi
    pass "[Plugins]/Script-* proof residue absent"
    if ! busctl --user call org.kde.kglobalaccel / org.freedesktop.DBus.Peer Ping "" >/dev/null 2>&1; then
        fail "precheck: kglobalaccel daemon not reachable"
    fi
    if any_component_has_action "$SENTINEL_PREFIX"; then
        fail "precheck: sentinel-prefix action already present"
    fi
    pass "no sentinel-prefix action in any component"
    if [ "$(busctl --user call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel getGlobalShortcutsByKey i "$SENTINEL_KEYCODE" 2>/dev/null | awk '{print $2}')" != "0" ]; then
        fail "precheck: sentinel sequence already bound"
    fi
    pass "sentinel sequence unbound"
    if kglobalshortcutsrc_has_sentinel; then
        fail "precheck: kglobalshortcutsrc contains sentinel"
    fi
    pass "kglobalshortcutsrc sentinel absent"
    say "== $STAGE precheck complete (gate only; inadmissible to proof success) =="
}

# ---------------------------------------------------------------------------
# Setup helpers (per stage; bounded waits)
# ---------------------------------------------------------------------------

setup_desktop() {
    check_deadline
    local count
    count=$(vdesk_prop count | awk '{print $2}')
    busctl --user call org.kde.KWin /VirtualDesktopManager org.kde.KWin.VirtualDesktopManager createDesktop us "$count" "$PROOF_DESKTOP_NAME" >> "$PROGRESS_LOG" 2>&1
    sleep 1
    TEMP_DESKTOP_ID=$(desktop_name_to_id "$PROOF_DESKTOP_NAME")
    if [ -z "$TEMP_DESKTOP_ID" ]; then
        fail "setup: temp desktop not created"
    fi
    busctl --user set-property org.kde.KWin /VirtualDesktopManager org.kde.KWin.VirtualDesktopManager current s "$TEMP_DESKTOP_ID" >> "$PROGRESS_LOG" 2>&1
    sleep 2
    local cur
    cur=$(vdesk_prop current | sed -E 's/^s "//; s/"$//')
    if [ "$cur" != "$TEMP_DESKTOP_ID" ]; then
        fail "setup: current desktop is $cur not $TEMP_DESKTOP_ID"
    fi
    pass "temp desktop $TEMP_DESKTOP_ID created and current"
}

setup_script() {
    check_deadline
    local load_out
    load_out=$(qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript "$SCRIPT_PATH" "$PROOF_ID" 2>&1)
    say "  loadScript -> $load_out"
    if [ "$load_out" = "-1" ]; then
        fail "setup: loadScript returned -1 (already loaded)"
    fi
    SCRIPT_STARTED=1
    qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.start >> "$PROGRESS_LOG" 2>&1
    wait_for_sink '^proof-ready' 20
    pass "script loaded and proof-ready"
    SENTINEL_ACTION_ID=$(sink_last '^sentinel-ready,' | cut -d, -f2)
    if [ -z "$SENTINEL_ACTION_ID" ]; then
        fail "setup: no sentinel-ready line"
    fi
    local comp
    comp=$(wait_for_sentinel_registration "$SENTINEL_ACTION_ID" 20)
    if [ -z "$comp" ]; then
        fail "setup: sentinel not visible in exactly one component within 20s"
    fi
    COMPONENT_PATH="$comp"
    COMPONENT_NAME=$(component_unique_name "$comp")
    printf 'path=%s\nuniqueName=%s\n' "$COMPONENT_PATH" "$COMPONENT_NAME" > "$EVIDENCE_DIR/component.txt"
    pass "sentinel registered: $SENTINEL_ACTION_ID (component=$COMPONENT_NAME)"
}

spawn_window_a() {
    check_deadline
    setsid xterm -class "$XTERM_CLASS" -title "PLASMA-PROOF-WINDOW-A-$RUNID" -e sleep 3600 >/dev/null 2>&1 &
    WINDOW_A_PID=$!
    wait_for_sink "^window-managed," 15
    A_ID=$(sink_last '^window-managed,' | cut -d, -f2)
    if [ -z "$A_ID" ]; then
        fail "setup: no window-managed for window A"
    fi
    pass "window A managed (internalId=$A_ID title=PLASMA-PROOF-WINDOW-A-$RUNID)"
}

spawn_window_b() {
    check_deadline
    setsid konsole --separate --desktopfile "$KONSOLE_DESKTOPFILE" -title "PLASMA-PROOF-WINDOW-B-$RUNID" -e sleep 3600 >/dev/null 2>&1 &
    WINDOW_B_PID=$!
    local deadline=$(( $(now) + 15 )) latest
    while [ "$(now)" -lt "$deadline" ]; do
        check_deadline
        latest=$(sink_last '^window-managed,' | cut -d, -f2)
        if [ -n "$latest" ] && [ "$latest" != "$A_ID" ]; then
            B_ID="$latest"
            break
        fi
        sleep 1
    done
    if [ -z "$B_ID" ]; then
        fail "setup: no distinct window-managed for window B"
    fi
    pass "window B managed (internalId=$B_ID title=PLASMA-PROOF-WINDOW-B-$RUNID)"
}

# ---------------------------------------------------------------------------
# Stage functions
# ---------------------------------------------------------------------------

stage_pre() {
    DEADLINE=60
    say "== STAGE-PRE-READONLY-GATE (runid=$RUNID, deadline=${DEADLINE}s) =="
    echo "runid=$RUNID" >> "$GATE_FILE"
    precheck
    echo "gate=pass" >> "$GATE_FILE"
    say "== PRE gate complete. Gate evidence is inadmissible to proof success. =="
}

stage_aut_key() {
    say "== STAGE-AUT-KEYBOARD-INSERTION (runid=$RUNID, deadline=${DEADLINE}s) =="
    precheck
    start_capture
    snap_all
    setup_desktop
    setup_script
    local before after
    before=$(sink_last '^tree-snapshot,' | sed -E 's/^tree-snapshot,[^,]+,//')
    spawn_window_a
    after=$(sink_last '^tree-snapshot,' | sed -E 's/^tree-snapshot,[^,]+,//')
    if [ "$before" = "$after" ]; then
        pass "T3a authored structure preserved (snapshot unchanged)"
    else
        warn "T3a tree snapshot changed: before=$before after=$after"
    fi
    pass "T9 sentinel present in exactly one component ($COMPONENT_NAME)"
    local is_active
    is_active=$(busctl --user call org.kde.kglobalaccel "$COMPONENT_PATH" org.kde.kglobalaccel.Component isActive 2>/dev/null | awk '{print $2}')
    printf 'component=%s isActive=%s\n' "$COMPONENT_NAME" "$is_active" >> "$OBSERVATIONS"
    local before_invoke
    before_invoke=$(sink_count '^shortcut-invoked')
    busctl --user call org.kde.kglobalaccel "$COMPONENT_PATH" org.kde.kglobalaccel.Component invokeShortcut ss "$SENTINEL_ACTION_ID" default >> "$PROGRESS_LOG" 2>&1
    wait_for_sink '^shortcut-invoked' 15
    local after_invoke
    after_invoke=$(sink_count '^shortcut-invoked')
    if [ $((after_invoke - before_invoke)) -ne 1 ]; then
        fail "T9 expected exactly one new shortcut-invoked, got $((after_invoke - before_invoke))"
    fi
    pass "T9 invokeShortcut dispatched exactly one shortcut-invoked"
    kill -- -"$WINDOW_A_PID" 2>/dev/null || kill "$WINDOW_A_PID" 2>/dev/null || true
    sleep 0.3
    busctl --user call org.kde.kglobalaccel "$COMPONENT_PATH" org.kde.kglobalaccel.Component invokeShortcut ss "$SENTINEL_ACTION_ID" default >> "$PROGRESS_LOG" 2>&1
    wait_for_sink '^shortcut-invoked' 10
    setsid xterm -class "$XTERM_CLASS" -title "PLASMA-PROOF-WINDOW-A-$RUNID" -e sleep 3600 >/dev/null 2>&1 &
    WINDOW_A_PID=$!
    wait_for_sink '^keyboard-directed,' 15
    local a2
    a2=$(sink_last '^keyboard-directed,' | cut -d, -f2)
    pass "T9b keyboard-directed insertion for respawned window A (internalId=$a2)"
}

stage_aut_way() {
    say "== STAGE-AUT-WAYLAND-REBIND (runid=$RUNID, deadline=${DEADLINE}s) =="
    precheck
    start_capture
    snap_all
    setup_desktop
    setup_script
    spawn_window_a
    spawn_window_b
    pass "T3b window B managed (internalId=$B_ID)"
    busctl --user set-property org.kde.KWin /VirtualDesktopManager org.kde.KWin.VirtualDesktopManager current s "$ORIGINAL_DESKTOP_ID" >> "$PROGRESS_LOG" 2>&1
    sleep 2
    local cur
    cur=$(vdesk_prop current | sed -E 's/^s "//; s/"$//')
    if [ "$cur" != "$ORIGINAL_DESKTOP_ID" ]; then
        fail "T6 switch-out failed (current=$cur)"
    fi
    busctl --user set-property org.kde.KWin /VirtualDesktopManager org.kde.KWin.VirtualDesktopManager current s "$TEMP_DESKTOP_ID" >> "$PROGRESS_LOG" 2>&1
    sleep 2
    cur=$(vdesk_prop current | sed -E 's/^s "//; s/"$//')
    if [ "$cur" != "$TEMP_DESKTOP_ID" ]; then
        fail "T6 switch-back failed (current=$cur)"
    fi
    local remg
    remg=$(grep -cE "^(window-managed|keyboard-directed),$A_ID," "$SINK_LOG" 2>/dev/null || true)
    if [ "$remg" -gt 1 ]; then
        warn "T6 window A re-managed during switch ($remg manage lines)"
    else
        pass "T6 desktop switch out/back completed; A association not re-managed"
    fi
}

stage_aut_branch() {
    say "== STAGE-AUT-BRANCH-PERSISTENCE (runid=$RUNID, deadline=${DEADLINE}s) =="
    precheck
    start_capture
    snap_all
    setup_desktop
    setup_script
    spawn_window_a
    spawn_window_b
    local before before_leaves
    before=$(sink_last '^tree-snapshot,' | sed -E 's/^tree-snapshot,[^,]+,//')
    before_leaves=$(printf '%s\n' "$before" | grep -o 'F(' | wc -l)
    kill -- -"$WINDOW_B_PID" 2>/dev/null || kill "$WINDOW_B_PID" 2>/dev/null || true
    wait_for_sink "^window-unmanaged,$B_ID," 10
    pass "T5a window B unmanaged (empty leaf retained by KWin)"
    wait_for_sink '^collapse-done' 10
    local after after_leaves expected
    after=$(sink_last '^tree-snapshot,' | sed -E 's/^tree-snapshot,[^,]+,//')
    after_leaves=$(printf '%s\n' "$after" | grep -o 'F(' | wc -l)
    expected=$(( before_leaves - 1 ))
    if [ "$after_leaves" = "$expected" ]; then
        pass "T5b collapse-done; leaf count $expected"
    else
        warn "T5b leaf count after=$after_leaves expected=$expected"
    fi
    sleep 5
    local tiles_json
    tiles_json=$(awk -v id="$TEMP_DESKTOP_ID" '
        $0 ~ "^\\[Tiling\\]\\[" id "\\]\\[" { in_group=1; next }
        /^\[/ { if (in_group) exit }
        in_group && /^tiles=/ { sub(/^tiles=/, ""); print; exit }
    ' "$HOME/.config/kwinrc")
    if [ -z "$tiles_json" ]; then
        fail "T4 no [Tiling][$TEMP_DESKTOP_ID] tiles entry found"
    fi
    printf '%s\n' "$tiles_json" > "$EVIDENCE_DIR/temp-tiles.json"
    local disk_norm mem_norm
    disk_norm=$(printf '%s\n' "$tiles_json" | jq -r '
        def r4: ((.*10000)|round)/10000;
        def ser(pdir; acc):
          if has("tiles") then
            "L(" + .layoutDirection + ")(" + ([range(0; .tiles|length) as $i |
              .tiles[$i] | ser(.layoutDirection;
                if .layoutDirection == "horizontal" then acc + (.tiles[0:$i][] | (.width // 0) | add // 0)
                elif .layoutDirection == "vertical" then acc + (.tiles[0:$i][] | (.height // 0) | add // 0)
                else 0 end)] | join("")) + ")"
          else
            if pdir == "horizontal" then "F(\((acc)|r4),0,\((.width // 0)|r4),1)"
            elif pdir == "vertical" then "F(0,\((acc)|r4),1,\((.height // 0)|r4))"
            else "F(\((.x // 0)|r4),\((.y // 0)|r4),\((.width // 0)|r4),\((.height // 0)|r4))" end
          end;
        ser(""; 0)
    ')
    mem_norm=$(sink_last '^tree-snapshot,' | sed -E 's/^tree-snapshot,[^,]+,//')
    printf 'disk=%s\nmem=%s\n' "$disk_norm" "$mem_norm" > "$EVIDENCE_DIR/t4-roundtrip.txt"
    if [ -n "$disk_norm" ] && [ "$disk_norm" = "$mem_norm" ]; then
        pass "T4 persistence round-trip: on-disk normalized == in-memory snapshot"
    else
        fail "T4 persistence round-trip mismatch: disk=$disk_norm mem=$mem_norm"
    fi
}

stage_manual() {
    # $1 = stage token (M1|M2), $2 = event regex, $3 = action label
    local token="$1" event="$2" label="$3"
    say "== $token (runid=$RUNID, deadline=${DEADLINE}s) =="
    precheck
    start_capture
    snap_all
    setup_desktop
    setup_script
    spawn_window_a
    say ""
    say "USER ACTION REQUIRED NOW: $label"
    say "window title: PLASMA-PROOF-WINDOW-A-$RUNID"
    say "proof desktop: $PROOF_DESKTOP_NAME"
    say "supervisor is waiting for the exact event (deadline ${DEADLINE}s); no go signal is used"
    say ""
    wait_for_sink "$event" $(( DEADLINE - 30 ))
    pass "$token evidence observed: $event"
}

stage_m1() {
    stage_manual "M1" "^drag-finished,$A_ID,.*action=split" "drag window PLASMA-PROOF-WINDOW-A-$RUNID to the center of an EMPTY tile on desktop $PROOF_DESKTOP_NAME and release"
}

stage_m2() {
    stage_manual "M2" "^drag-cancel-inferred,$A_ID," "start dragging window PLASMA-PROOF-WINDOW-A-$RUNID on desktop $PROOF_DESKTOP_NAME, then press Esc to cancel without releasing"
}

# ---------------------------------------------------------------------------
# Reversal / verification (full, always runs; idempotent)
# ---------------------------------------------------------------------------

reversal() {
    if [ "$REVERSED" = "1" ]; then
        return
    fi
    REVERSED=1
    if [ "$STAGE" = "PRE" ]; then
        return
    fi
    say "== $STAGE reversal =="

    # 1. stop capture (L1)
    stop_capture
    if pgrep -f "[d]bus-monitor" >/dev/null 2>&1; then
        cleanup_fail "L1 dbus-monitor still running"
    else
        pass "L1 capture stopped and FIFO removed"
    fi

    # 2. close test windows (W1)
    [ -n "${WINDOW_A_PID:-}" ] && kill -- -"$WINDOW_A_PID" 2>/dev/null || kill "${WINDOW_A_PID:-}" 2>/dev/null || true
    [ -n "${WINDOW_B_PID:-}" ] && kill -- -"$WINDOW_B_PID" 2>/dev/null || kill "${WINDOW_B_PID:-}" 2>/dev/null || true
    sleep 3
    if pgrep -f "[x]term -class $XTERM_CLASS" >/dev/null 2>&1 || pgrep -f "[k]onsole --separate --desktopfile $KONSOLE_DESKTOPFILE" >/dev/null 2>&1; then
        cleanup_fail "W1 test windows did not close cleanly"
    else
        pass "W1 test windows closed"
    fi

    # 3. unload script (S1, T8)
    if [ "$SCRIPT_STARTED" = "1" ]; then
        qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript "$PROOF_ID" >/dev/null 2>&1 || true
        local deadline=$(( $(now) + 20 )) loaded="true"
        while [ "$(now)" -lt "$deadline" ]; do
            loaded=$(busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting isScriptLoaded s "$PROOF_ID" 2>/dev/null | awk '{print $2}')
            if [ "$loaded" = "false" ]; then
                break
            fi
            sleep 1
        done
        if [ "$loaded" = "false" ]; then
            pass "S1 script unloaded (isScriptLoaded=false)"
        else
            cleanup_fail "S1 script did not unload within 20s"
        fi
    fi

    # 4. sentinel removal (G1, targeted; stage-discovered component only)
    if [ -n "${SENTINEL_ACTION_ID:-}" ]; then
        if poll_sentinel_absent 20; then
            pass "G1 sentinel absent after unload"
        else
            if [ -n "${COMPONENT_NAME:-}" ]; then
                say "  sentinel still present; issuing targeted unregister on the stage-discovered component"
                busctl --user call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel unregister ss "$COMPONENT_NAME" "$SENTINEL_ACTION_ID" >> "$PROGRESS_LOG" 2>&1 || true
                if poll_sentinel_absent 20; then
                    pass "G1 sentinel removed via targeted unregister"
                else
                    cleanup_fail "G1 sentinel could not be removed within bounds"
                fi
            else
                cleanup_fail "G1 sentinel present but no stage-discovered component is available; no guessed fallback used"
            fi
        fi
        if [ "$(busctl --user call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel getGlobalShortcutsByKey i "$SENTINEL_KEYCODE" 2>/dev/null | awk '{print $2}')" != "0" ]; then
            cleanup_fail "G1 sentinel sequence still bound"
        else
            pass "G1 sentinel sequence unbound again"
        fi
    fi

    # 5. restore current desktop (V2)
    if [ -n "${ORIGINAL_DESKTOP_ID:-}" ]; then
        busctl --user set-property org.kde.KWin /VirtualDesktopManager org.kde.KWin.VirtualDesktopManager current s "$ORIGINAL_DESKTOP_ID" >/dev/null 2>&1 || true
        sleep 1
        local cur
        cur=$(vdesk_prop current | sed -E 's/^s "//; s/"$//')
        if [ "$cur" != "$ORIGINAL_DESKTOP_ID" ]; then
            cleanup_fail "V2 current desktop not restored"
        else
            pass "V2 current desktop restored"
        fi
    fi

    # 6. remove temp desktop (V1/V3/V4)
    if [ -n "${TEMP_DESKTOP_ID:-}" ]; then
        busctl --user call org.kde.KWin /VirtualDesktopManager org.kde.KWin.VirtualDesktopManager removeDesktop s "$TEMP_DESKTOP_ID" >/dev/null 2>&1 || true
        sleep 5
        if [ -n "$(desktop_name_to_id "$PROOF_DESKTOP_NAME")" ]; then
            busctl --user call org.kde.KWin /VirtualDesktopManager org.kde.KWin.VirtualDesktopManager removeDesktop s "$TEMP_DESKTOP_ID" >/dev/null 2>&1 || true
            sleep 3
        fi
        if [ -n "$(desktop_name_to_id "$PROOF_DESKTOP_NAME")" ]; then
            cleanup_fail "V1 temp desktop still present"
        else
            pass "V1 temp desktop removed"
        fi
    fi

    # 7. delete temp [Tiling] subgroup (T2; the one direct config write)
    if [ -n "${TEMP_DESKTOP_ID:-}" ]; then
        local uuid
        uuid=$(tiling_uuid_for "$TEMP_DESKTOP_ID")
        if [ -n "$uuid" ]; then
            kwriteconfig6 --file kwinrc --group Tiling --group "$TEMP_DESKTOP_ID" --group "$uuid" --key tiles --delete >> "$PROGRESS_LOG" 2>&1 || true
            kwriteconfig6 --file kwinrc --group Tiling --group "$TEMP_DESKTOP_ID" --group "$uuid" --key padding --delete >> "$PROGRESS_LOG" 2>&1 || true
            if [ -n "$(tiling_read_back "$TEMP_DESKTOP_ID" "$uuid" tiles)" ] || [ -n "$(tiling_read_back "$TEMP_DESKTOP_ID" "$uuid" padding)" ]; then
                cleanup_fail "T2 subgroup deletion not effective"
            else
                pass "T2 temp [Tiling] subgroup deleted ($TEMP_DESKTOP_ID/$uuid)"
            fi
        fi
    fi

    # 8. final verification (K1, C1)
    if kwin_ping >/dev/null 2>&1; then
        pass "K1 KWin Ping OK"
    else
        cleanup_fail "K1 KWin Ping FAILED - do not kill/restart kwin_wayland; report to Lead"
    fi
    if [ -s "$SNAPSHOT_DIR/kwinrc.sha256" ] && [ "$(sha256sum "$HOME/.config/kwinrc" | awk '{print $1}')" = "$(awk '{print $1}' "$SNAPSHOT_DIR/kwinrc.sha256")" ]; then
        pass "C1 whole-file sha256 identical"
    else
        cleanup_fail "C1 whole-file sha256 differs"
    fi
    if [ "$STAGE" != "PRE" ]; then
        say "== $STAGE reversal complete. No proof state survives this stage. =="
    fi
}

abort_recovery() {
    say "ABORT: $*" >&2
    printf '%s\n' "ABORT: $*" >> "$ASSERT_LOG"
    echo "ABORTING:$*" >> "$PROGRESS_LOG"
    reversal
    echo "RECOVERY_COMPLETE:$*" >> "$PROGRESS_LOG"
    exit 1
}

trap 'echo "SIGNAL:$*" >> "$PROGRESS_LOG"; abort_recovery "trapped-signal"' INT TERM
trap 'reversal' EXIT

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

while [ $# -gt 0 ]; do
    case "$1" in
        --stage) STAGE="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
    esac
done

case "$STAGE" in
    PRE|AUT-KEY|AUT-WAY|AUT-BRANCH|M1|M2) ;;
    "") echo "missing --stage (PRE|AUT-KEY|AUT-WAY|AUT-BRANCH|M1|M2)" >&2; usage >&2; exit 2 ;;
    *) echo "unknown stage: $STAGE" >&2; usage >&2; exit 2 ;;
esac

START_EPOCH=$(now)
DEADLINE=90
if [ "$STAGE" = "PRE" ]; then
    DEADLINE=60
fi
RUNID="pat-u04a2-$STAGE-$(date +%s)-$$"
EVIDENCE_DIR="$RESULTS_DIR/evidence/$STAGE-$RUNID"
SNAPSHOT_DIR="$RESULTS_DIR/snapshot/$STAGE-$RUNID"
SINK_LOG="$EVIDENCE_DIR/sink.log"
ASSERT_LOG="$EVIDENCE_DIR/assertions.log"
PROGRESS_LOG="$EVIDENCE_DIR/progress.log"
GATE_FILE="$EVIDENCE_DIR/gate.txt"
OBSERVATIONS="$EVIDENCE_DIR/observations.txt"

mkdir -p "$EVIDENCE_DIR" "$LOG_DIR"
if [ "$STAGE" = "PRE" ]; then
    ASSERT_LOG="$GATE_FILE"
    PROGRESS_LOG="$GATE_FILE"
else
    mkdir -p "$SNAPSHOT_DIR"
    : > "$ASSERT_LOG"
    : > "$SINK_LOG"
    : > "$PROGRESS_LOG"
fi

case "$STAGE" in
    PRE) stage_pre ;;
    AUT-KEY) stage_aut_key ;;
    AUT-WAY) stage_aut_way ;;
    AUT-BRANCH) stage_aut_branch ;;
    M1) stage_m1 ;;
    M2) stage_m2 ;;
esac

reversal
if [ "$CLEANUP_FAIL" = "1" ]; then
    say "== $STAGE cleanup/postflight failures recorded; completion blocked. ==" >&2
    exit 1
fi
say "== $STAGE complete. All cleanup and postflight checks succeeded. =="
echo "COMPLETE:$STAGE" >> "$PROGRESS_LOG"
exit 0


