#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/live-native-effect-test.sh"
PLUGIN_ID="plasma-auto-tiler-active-border"
EFFECT_VERSION="6.7.3"
FAKE_BIN="$(mktemp -d)"
WORK="$(mktemp -d)"
OUTPUT="$(mktemp)"
EVIDENCE_ROOT="$WORK/evidence"
HOST_RUNTIME="$WORK/host-runtime"
HOST_HOME="$WORK/host-home"
PASS=0
FAIL=0
EXIT=0
TIMEOUT_PID=""
INT_SESSION_PID=""
WATCHDOG_PID=""

valid_positive_pid() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

cleanup_nested_dead_leader_member() {
  local nested_member_pid i
  local nested_member_pid_file="$WORK/state/nested-dead-leader-member-pid"

  [[ -f "$nested_member_pid_file" ]] || return 0
  nested_member_pid="$(<"$nested_member_pid_file")"
  if [[ "$nested_member_pid" =~ ^[1-9][0-9]*$ ]] && \
     "$REAL_KILL_BIN" -0 -- "$nested_member_pid" 2>/dev/null; then
    "$REAL_KILL_BIN" -TERM -- "$nested_member_pid" 2>/dev/null || true
    for i in $(seq 1 40); do
      "$REAL_KILL_BIN" -0 -- "$nested_member_pid" 2>/dev/null || break
      "$REAL_SLEEP" 0.05
    done
  fi
  rm -f -- "$nested_member_pid_file"
}

# Harness self-cleanup: exact PIDs/groups this harness created only, including
# failure paths. RUNNER_PID is the exact background runner; DECOY is the exact
# permitted decoy and an unaccepted nested fake identified by its launch marker.
# Process cleanup runs before temp-file removal so runner-owned children are
# reaped by the runner's own traps.
harness_cleanup() {
  local exit_status=$? completed_pid="" completed_status=0
  # Fallback cleanup is restricted to the exact runner started by run_bg.
  if valid_positive_pid "${RUNNER_PID:-}"; then
    "$REAL_KILL_BIN" -TERM -- "$RUNNER_PID" 2>/dev/null || true
    "$REAL_SLEEP" 2 &
    WATCHDOG_PID=$!
    set +e
    wait -n -p completed_pid "$RUNNER_PID" "$WATCHDOG_PID"
    completed_status=$?
    set -e
    if [[ "$completed_pid" == "$WATCHDOG_PID" ]]; then
      WATCHDOG_PID=""
      "$REAL_KILL_BIN" -KILL -- "$RUNNER_PID" 2>/dev/null || true
      "$REAL_SLEEP" 2 &
      WATCHDOG_PID=$!
      set +e
      wait -n -p completed_pid "$RUNNER_PID" "$WATCHDOG_PID"
      completed_status=$?
      set -e
    fi
    if [[ "$completed_pid" == "$RUNNER_PID" ]]; then
      RUNNER_PID=""
    fi
    if valid_positive_pid "${WATCHDOG_PID:-}"; then
      "$REAL_KILL_BIN" -TERM -- "$WATCHDOG_PID" 2>/dev/null || true
      set +e
      wait "$WATCHDOG_PID" 2>/dev/null
      set -e
      WATCHDOG_PID=""
    fi
  fi
  if valid_positive_pid "${INT_SESSION_PID:-}"; then
    "$REAL_KILL_BIN" -TERM -- "$INT_SESSION_PID" 2>/dev/null || true
  fi
  if valid_positive_pid "${TIMEOUT_PID:-}"; then
    "$REAL_KILL_BIN" -TERM -- "$TIMEOUT_PID" 2>/dev/null || true
    wait "$TIMEOUT_PID" 2>/dev/null || true
  fi
  if [[ -n "${DECOY:-}" ]] && [[ "$DECOY" -ne 0 ]] && kill -0 "$DECOY" 2>/dev/null; then
    kill -TERM "$DECOY" 2>/dev/null || true
  fi
  if [[ -n "${UNACCEPTED_NESTED_PID:-}" ]] && kill -0 "$UNACCEPTED_NESTED_PID" 2>/dev/null; then
    kill -TERM "$UNACCEPTED_NESTED_PID" 2>/dev/null || true
  fi
  if [[ "${HARNESS_DEBUG_ON_FAILURE:-}" == "1" && "$exit_status" -ne 0 ]]; then
    printf '%s\n' '===== HARNESS DEBUG ON FAILURE BEGIN =====' >&2
    printf '%s\n' '----- runner output -----' >&2
    cat "$OUTPUT" >&2
    printf '%s\n' '----- fake calls log -----' >&2
    cat "$WORK/calls.log" >&2
    for file in "$EVIDENCE_ROOT/owned-pids" "$EVIDENCE_ROOT/manifest.txt" \
      "$WORK/state/nested-pid" "$WORK/state/setsid-nested-pid" \
      "$WORK/state/setsid-client-pids" "$WORK/state/nested-pgid-mismatch" \
      "$WORK/state/client-pgid-mismatch" "$WORK/state/ps-result"; do
      if [[ -f "$file" ]]; then
        printf '%s\n' "----- ${file##*/} -----" >&2
        cat "$file" >&2
      fi
    done
    printf '%s\n' '===== HARNESS DEBUG ON FAILURE END =====' >&2
  fi
  cleanup_nested_dead_leader_member
  rm -rf "$FAKE_BIN" "$WORK" "$OUTPUT"
}
trap harness_cleanup EXIT

REAL_KILL_BIN="$(type -P kill || true)"
REAL_TIMEOUT="$(command -v timeout || true)"
REAL_SLEEP="$(command -v sleep)"
REAL_SETSID="$(command -v setsid)"
BASH_PATH="$(command -v bash)"

fail() {
  echo "FAIL: $1" >&2
  FAIL=$((FAIL + 1))
}

check_exit() {
  local expected="$1"
  if [[ "$EXIT" -ne "$expected" ]]; then
    echo "FAIL: expected exit $expected, got $EXIT" >&2
    echo "--- output ---" >&2
    cat "$OUTPUT" >&2
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
}

assert_contains() {
  local needle="$1"
  if grep -Fq "$needle" "$OUTPUT"; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: output does not contain '$needle'" >&2
    echo "--- output ---" >&2
    cat "$OUTPUT" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_not_contains() {
  local needle="$1"
  if grep -Fq "$needle" "$OUTPUT"; then
    echo "FAIL: output unexpectedly contains '$needle'" >&2
    echo "--- output ---" >&2
    cat "$OUTPUT" >&2
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
}

assert_calls_contains() {
  if grep -Fq -- "$1" "$WORK/calls.log"; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: calls.log does not contain '$1'" >&2
    cat "$WORK/calls.log" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_calls_not_contains() {
  if grep -Fq -- "$1" "$WORK/calls.log"; then
    echo "FAIL: calls.log unexpectedly contains '$1'" >&2
    cat "$WORK/calls.log" >&2
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
}

assert_calls_count() {
  local needle="$1" expected="$2" count
  count="$(grep -Fc -- "$needle" "$WORK/calls.log" || true)"
  if [[ "$count" -eq "$expected" ]]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: calls.log contains '$needle' $count time(s), expected $expected" >&2
    cat "$WORK/calls.log" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_kill_log_contains() {
  if grep -Fq -- "$1" "$WORK/kill.log"; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: kill.log does not contain '$1'" >&2
    cat "$WORK/kill.log" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_kill_log_not_contains() {
  if grep -Fq -- "$1" "$WORK/kill.log"; then
    echo "FAIL: kill.log unexpectedly contains '$1'" >&2
    cat "$WORK/kill.log" >&2
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
}

assert_calls_line_before() {
  local first="$1" second="$2"
  local a b
  a="$(grep -nF "$first" "$WORK/calls.log" | head -1 | cut -d: -f1)"
  b="$(grep -nF "$second" "$WORK/calls.log" | head -1 | cut -d: -f1)"
  if [[ -n "$a" && -n "$b" && "$a" -lt "$b" ]]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: expected '$first' before '$second'" >&2
    cat "$WORK/calls.log" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_file() {
  if [[ -e "$1" ]]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: expected file '$1'" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_file_contains() {
  local file="$1" needle="$2"
  if [[ -f "$file" ]] && grep -Fq -- "$needle" "$file"; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: '$file' does not contain '$needle'" >&2
    [[ -f "$file" ]] && cat "$file" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_file_line() {
  local file="$1" line="$2"
  if [[ -f "$file" ]] && grep -Fxq -- "$line" "$file"; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: '$file' does not contain exact line '$line'" >&2
    [[ -f "$file" ]] && cat "$file" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_file_line_before() {
  local file="$1" first="$2" second="$3"
  local a b
  a="$(grep -nF -- "$first" "$file" | head -1 | cut -d: -f1 || true)"
  b="$(grep -nF -- "$second" "$file" | head -1 | cut -d: -f1 || true)"
  if [[ -n "$a" && -n "$b" && "$a" -lt "$b" ]]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: expected '$first' before '$second' in '$file'" >&2
    [[ -f "$file" ]] && cat "$file" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_file_size_between() {
  local file="$1" min="$2" max="$3" size
  if [[ -f "$file" ]]; then
    size="$(wc -c < "$file")"
    if [[ "$size" -ge "$min" && "$size" -le "$max" ]]; then
      PASS=$((PASS + 1))
      return
    fi
  fi
  echo "FAIL: '$file' size is not between $min and $max bytes" >&2
  FAIL=$((FAIL + 1))
}

assert_not_exists() {
  if [[ ! -e "$1" ]]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: unexpected path '$1'" >&2
    FAIL=$((FAIL + 1))
  fi
}

env_value() {
  sed -n "s/^$1=//p" "$WORK/env.log" | head -1
}

assert_env_private() {
  local key="$1"
  local expected_count=1
  [[ "$key" == CLIENT_* ]] && expected_count=2
  local count value line
  count="$(grep -c "^$key=" "$WORK/env.log" || true)"
  if [[ "$count" -ne "$expected_count" ]]; then
    echo "FAIL: $key captured $count value(s), expected $expected_count" >&2
    cat "$WORK/env.log" >&2
    FAIL=$((FAIL + 1))
    return
  fi
  while IFS= read -r line; do
    value="${line#*=}"
    if [[ -z "$value" || "$value" != "$EVIDENCE_ROOT/"* ]]; then
      echo "FAIL: $key is not under the private evidence root: '$value'" >&2
      cat "$WORK/env.log" >&2
      FAIL=$((FAIL + 1))
      return
    fi
  done < <(grep "^$key=" "$WORK/env.log")
  PASS=$((PASS + 1))
}

assert_all_private() {
  local key="$1"
  if ! grep -q "^$key=" "$WORK/env.log"; then
    echo "FAIL: $key was never captured" >&2
    FAIL=$((FAIL + 1))
    return
  fi
  if grep "^$key=" "$WORK/env.log" | grep -qv "^$key=$EVIDENCE_ROOT/"; then
    echo "FAIL: $key has a non-private value" >&2
    cat "$WORK/env.log" >&2
    FAIL=$((FAIL + 1))
    return
  fi
  PASS=$((PASS + 1))
}

assert_transitions() {
  local expected="$1"
  if diff <(printf '%s\n' "$expected") "$WORK/transitions.log" >/dev/null 2>&1; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: /Effects transition order mismatch" >&2
    echo "expected:" >&2
    printf '%s\n' "$expected" >&2
    echo "actual:" >&2
    cat "$WORK/transitions.log" >&2
    FAIL=$((FAIL + 1))
  fi
}

wait_for() {
  local i
  for i in $(seq 1 40); do
    [[ -e "$1" ]] && return 0
    sleep 0.01
  done
  return 1
}

wait_for_valid_positive_pid() {
  local file="$1" i pid
  for i in $(seq 1 400); do
    if [[ -f "$file" ]]; then
      pid="$(<"$file")"
      if valid_positive_pid "$pid"; then
        printf '%s' "$pid"
        return 0
      fi
    fi
    "$REAL_SLEEP" 0.05
  done
  return 1
}

wait_for_clients() {
  local i n
  for i in $(seq 1 400); do
    if [[ -f "$WORK/state/client-pids" ]]; then
      n="$(wc -l < "$WORK/state/client-pids")"
    else
      n=0
    fi
    [[ "$n" -ge 2 && -f "$WORK/state/clients-owned-and-live" ]] && return 0
    sleep 0.05
  done
  cat "$OUTPUT" >&2
  return 1
}

wait_for_effect_load() {
  local i
  for i in $(seq 1 400); do
    if grep -Fxq "loadEffect $PLUGIN_ID" "$WORK/transitions.log" && \
       grep -Fxq "isEffectLoaded $PLUGIN_ID true" "$WORK/transitions.log" && \
       grep -Fq -- "gdbus call --address unix:path=$EVIDENCE_ROOT/run/private-bus --dest org.kde.KWin --object-path /Effects --method org.kde.KWin.Effects.loadEffect $PLUGIN_ID" "$WORK/calls.log"; then
      return 0
    fi
    "$REAL_SLEEP" 0.05
  done
  cat "$OUTPUT" >&2
  cat "$WORK/calls.log" >&2
  cat "$WORK/transitions.log" >&2
  return 1
}

wait_for_session_pid() {
  local i session_pid
  for i in $(seq 1 400); do
    session_pid="$(sed -n 's/^session_pid=//p' "$EVIDENCE_ROOT/manifest.txt" 2>/dev/null)"
    if valid_positive_pid "$session_pid"; then
      INT_SESSION_PID="$session_pid"
      return 0
    fi
    "$REAL_SLEEP" 0.05
  done
  cat "$EVIDENCE_ROOT/manifest.txt" >&2
  return 1
}

make_fake_tools() {
  mkdir -p "$FAKE_BIN"

  cat > "$FAKE_BIN/kwin_wayland" <<'EOF'
#!/usr/bin/env bash
state="${FAKE_STATE_DIR:?}"
printf 'kwin_wayland %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
if [[ "${1:-}" == "--version" ]]; then
  if [[ -f "$state/abi-mismatch" ]]; then
    printf 'kwin 9.9.9\n'
  else
    printf 'kwin 6.7.3\n'
  fi
  exit 0
fi
{
  printf 'KWIN_PID=%s\nKWIN_PGID=%s\nKWIN_HOME=%s\nKWIN_KDEHOME=%s\nKWIN_XDG_CONFIG_HOME=%s\nKWIN_XDG_DATA_HOME=%s\nKWIN_XDG_CACHE_HOME=%s\nKWIN_XDG_STATE_HOME=%s\nKWIN_XDG_RUNTIME_DIR=%s\nKWIN_WAYLAND_DISPLAY=%s\nKWIN_DBUS=%s\nKWIN_QT_PLUGIN_PATH=%s\nKWIN_KWIN_COMPOSE=%s\n' \
    "$$" "$$" "${HOME-}" "${KDEHOME-}" "${XDG_CONFIG_HOME-}" "${XDG_DATA_HOME-}" "${XDG_CACHE_HOME-}" "${XDG_STATE_HOME-}" "${XDG_RUNTIME_DIR-}" "${WAYLAND_DISPLAY-}" "${DBUS_SESSION_BUS_ADDRESS-}" "${QT_PLUGIN_PATH-}" "${KWIN_COMPOSE-}"
} >> "${FAKE_ENV_LOG:?}"
plugin_dir="${QT_PLUGIN_PATH:-}/kwin/effects/plugins"
if [[ -f "${EVIDENCE_ROOT:-}/preflight-compositor" ]]; then
  printf 'KWIN_PREFLIGHT_COMPOSITOR=%s\n' "$(<"${EVIDENCE_ROOT:-}/preflight-compositor")" >> "${FAKE_ENV_LOG:?}"
fi
if [[ -n "${QT_PLUGIN_PATH:-}" && -d "$plugin_dir" ]]; then
  plugin="$(printf '%s\n' "$plugin_dir"/*.so 2>/dev/null | head -1)"
  if [[ -f "$plugin" ]]; then
    printf 'KWIN_PLUGIN_RESOLVED=%s\n' "$plugin" >> "${FAKE_ENV_LOG:?}"
  fi
fi
printf '%s\n' "$*" > "$state/nested-argv"
printf '%s\n' "$$" > "$state/nested-pid"
if [[ -f "$state/nested-block-start" ]]; then
  while [[ ! -f "$state/nested-block-release" ]]; do sleep 0.05; done
fi
if [[ -f "$state/nested-start-fail" ]]; then
  echo "kwin_wayland: failed to start nested backend" >&2
  exit 7
fi
if [[ -f "$state/nested-start-exit0" ]]; then
  exit 0
fi
if [[ -f "$state/opengl-unsupported" ]]; then
  echo "kwin_wayland: OpenGL compositing is not supported on this backend" >&2
  exit 3
fi
mkdir -p "${XDG_RUNTIME_DIR:?}"
touch "${XDG_RUNTIME_DIR:?}/$WAYLAND_DISPLAY"
touch "$state/nested-ready"
  while [[ ! -f "$state/nested-stop" ]]; do
  if [[ -f "$state/nested-leader-exits-with-group" && -f "$state/client-stop" ]]; then
    "${REAL_SLEEP:?}" 300 &
    printf '%s\n' "$!" > "$state/nested-dead-leader-member-pid"
    exit 0
  fi
  sleep 0.05
  if [[ -f "$state/nested-crash" && -f "$state/effect-loaded" ]]; then
    exit 9
  fi
done
exit 0
EOF

  cat > "$FAKE_BIN/weston-terminal" <<'EOF'
#!/usr/bin/env bash
state="${FAKE_STATE_DIR:?}"
if [[ -f "$state/client-a-exits-early" && ! -f "$state/client-a-started" ]]; then
  : > "$state/client-a-started"
  exit 0
fi
printf 'weston-terminal %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
{
  printf 'CLIENT_PID=%s\nCLIENT_PGID=%s\nCLIENT_HOME=%s\nCLIENT_KDEHOME=%s\nCLIENT_XDG_CONFIG_HOME=%s\nCLIENT_XDG_DATA_HOME=%s\nCLIENT_XDG_CACHE_HOME=%s\nCLIENT_XDG_STATE_HOME=%s\nCLIENT_XDG_RUNTIME_DIR=%s\nCLIENT_WAYLAND_DISPLAY=%s\nCLIENT_DBUS=%s\n' \
    "$$" "$$" "${HOME-}" "${KDEHOME-}" "${XDG_CONFIG_HOME-}" "${XDG_DATA_HOME-}" "${XDG_CACHE_HOME-}" "${XDG_STATE_HOME-}" "${XDG_RUNTIME_DIR-}" "${WAYLAND_DISPLAY-}" "${DBUS_SESSION_BUS_ADDRESS-}"
} >> "${FAKE_ENV_LOG:?}"
printf '%s\n' "$$" >> "$state/client-pids"
while [[ ! -f "$state/client-stop" ]]; do sleep 0.05; done
exit 0
EOF

  cat > "$FAKE_BIN/dbus-run-session" <<'EOF'
#!/usr/bin/env bash
printf 'dbus-run-session %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
export DBUS_SESSION_BUS_ADDRESS="unix:path=${EVIDENCE_ROOT:?}/run/private-bus"
args=("$@")
if [[ "${args[0]}" == "--" ]]; then
  args=("${args[@]:1}")
fi
exec "${args[@]}"
EOF

  cat > "$FAKE_BIN/gdbus" <<'EOF'
#!/usr/bin/env bash
state="${FAKE_STATE_DIR:?}"
printf 'gdbus %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
if [[ " $* " == *" --user "* ]]; then
  printf 'gdbus-used-user\n' >> "$state/dbus-user-violation"
fi
method=""
effect=""
prev=""
for a in "$@"; do
  if [[ "$prev" == "--method" ]]; then method="$a"; fi
  prev="$a"
  effect="$a"
done
case "$method" in
  *supportInformation)
    printf 'supportInformation %s\n' "$effect" >> "${FAKE_TRANSITION_LOG:?}"
    if [[ -f "$state/effect-unsupported" ]]; then
      echo "gdbus: error: GDBus.Error:org.kde.KWin.Effects.NoSuchEffect" >&2
      exit 1
    fi
    printf "KWin 6.7.3\n"
    ;;
  *isEffectLoaded)
    if [[ -f "$state/effect-loaded" ]]; then
      printf 'isEffectLoaded %s true\n' "$effect" >> "${FAKE_TRANSITION_LOG:?}"
      printf '(true,)\n'
    else
      printf 'isEffectLoaded %s false\n' "$effect" >> "${FAKE_TRANSITION_LOG:?}"
      printf '(false,)\n'
    fi
    ;;
  *unloadEffect)
    printf 'unloadEffect %s\n' "$effect" >> "${FAKE_TRANSITION_LOG:?}"
    rm -f "$state/effect-loaded"
    printf '()\n'
    ;;
  *loadEffect)
    printf 'loadEffect %s\n' "$effect" >> "${FAKE_TRANSITION_LOG:?}"
    touch "$state/effect-loaded"
    printf '()\n'
    ;;
  *Properties.Get)
    if [[ " $* " == *" compositingType "* ]]; then
      if [[ -f "$state/opengl-inactive" ]]; then
        printf "(<'none'>,)\n"
      else
        printf "(<'gl2'>,)\n"
      fi
    else
      printf 'other\n'
    fi
    ;;
  *)
    printf 'other\n'
    ;;
esac
EOF

  cat > "$FAKE_BIN/cmake" <<'EOF'
#!/usr/bin/env bash
state="${FAKE_STATE_DIR:?}"
printf 'cmake %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
{
  printf 'CMAKE_HOME=%s\n' "${HOME-}"
  printf 'CMAKE_KDEHOME=%s\n' "${KDEHOME-}"
  printf 'CMAKE_XDG_CONFIG_HOME=%s\n' "${XDG_CONFIG_HOME-}"
  printf 'CMAKE_XDG_DATA_HOME=%s\n' "${XDG_DATA_HOME-}"
  printf 'CMAKE_XDG_CACHE_HOME=%s\n' "${XDG_CACHE_HOME-}"
  printf 'CMAKE_XDG_STATE_HOME=%s\n' "${XDG_STATE_HOME-}"
  printf 'CMAKE_XDG_RUNTIME_DIR=%s\n' "${XDG_RUNTIME_DIR-}"
} >> "${FAKE_ENV_LOG:?}"
builddir=""
prev=""
for a in "$@"; do
  if [[ "$prev" == "-B" ]]; then builddir="$a"; fi
  if [[ "$prev" == "--build" ]]; then builddir="$a"; fi
  prev="$a"
done
  if [[ " $* " == *" --build "* ]]; then
  if [[ -f "$state/build-fail" ]]; then
    echo "cmake: build failed" >&2
    exit 1
  fi
  mkdir -p "$builddir/kwin/effects/plugins"
    printf 'fake-plugin\n' > "$builddir/kwin/effects/plugins/plasma-auto-tiler-active-border.so"
    printf 'fake build complete\n'
    exit 0
  fi
  if [[ -n "$builddir" ]]; then
    mkdir -p "$builddir" "$state/kwin-cmake"
    printf 'KWin_DIR:PATH=%s/kwin-cmake\n' "$state" > "$builddir/CMakeCache.txt"
    printf 'set(PACKAGE_VERSION "6.7.3")\n' > "$state/kwin-cmake/KWinConfigVersion.cmake"
    printf 'fake configure complete\n'
  fi
  exit 0
EOF

  cat > "$FAKE_BIN/journalctl" <<'EOF'
#!/usr/bin/env bash
state="${FAKE_STATE_DIR:?}"
printf 'journalctl %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
if [[ -f "$state/journal-unavailable" ]]; then
  echo 'journalctl: unavailable' >&2
  exit 1
fi
printf 'fake journal %s\n' "$*"
EOF

cat > "$FAKE_BIN/sleep" <<'EOF'
#!/usr/bin/env bash
printf 'sleep %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
if [[ -f "${FAKE_STATE_DIR:?}/cleanup-verification-fail" && "$#" -eq 1 && "$1" == "0.1" ]]; then
  exit 0
fi
exec "${REAL_SLEEP:?}" "$@"
EOF

cat > "$FAKE_BIN/setsid" <<'EOF'
#!/usr/bin/env bash
state="${FAKE_STATE_DIR:?}"
printf 'setsid %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
case "${1:-}" in
  *kwin_wayland)
    nested_pid_tmp="$(mktemp "$state/.setsid-nested-pid.XXXXXX")"
    printf '%s\n' "$$" > "$nested_pid_tmp"
    mv -f -- "$nested_pid_tmp" "$state/setsid-nested-pid"
    ;;
  *weston-terminal) printf '%s\n' "$$" >> "$state/setsid-client-pids" ;;
esac
exec "${REAL_SETSID:?}" "$@"
EOF

  cat > "$FAKE_BIN/ps" <<'EOF'
#!/usr/bin/env bash
state="${FAKE_STATE_DIR:?}"
printf 'ps %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
pid=""
prev=""
for arg in "$@"; do
  if [[ "$prev" == "-p" ]]; then pid="$arg"; break; fi
  prev="$arg"
done
if [[ -z "$pid" ]]; then
  printf 'requested_pid=%s\nemitted_pid=%s\nemitted_pgid=%s\nexit_status=%s\n' \
    "$pid" "" "" "1" > "$state/ps-result"
  exit 1
fi
if ! "${REAL_KILL_BIN:?}" -0 "$pid" 2>/dev/null; then
  printf 'requested_pid=%s\nemitted_pid=%s\nemitted_pgid=%s\nexit_status=%s\n' \
    "$pid" "" "" "1" > "$state/ps-result"
  exit 1
fi
if [[ -f "$state/ps-probe-fail" ]]; then
  printf 'requested_pid=%s\nemitted_pid=%s\nemitted_pgid=%s\nexit_status=%s\n' \
    "$pid" "" "" "42" > "$state/ps-result"
  printf 'fake ps probe failure for pid %s\n' "$pid" >&2
  exit 42
fi
if [[ -f "$state/ps-oversized-stdout" ]]; then
  printf 'requested_pid=%s\nemitted_pid=%s\nemitted_pgid=%s\nexit_status=%s\n' \
    "$pid" "$pid" "$pid" "0" > "$state/ps-result"
  printf '%2048s' ''
  printf '%2048s' ''
  printf '%2048s' ''
  printf '%2048s' ''
  printf 'x'
  exit 0
fi
emitted_pid="$pid"
emitted_pgid="$pid"
if [[ -f "$state/nested-pgid-mismatch" ]]; then
  nested_mismatch_target="$state/nested-pgid-mismatch-target"
  if [[ ! -f "$nested_mismatch_target" ]]; then
    nested_mismatch_tmp="$(mktemp "$state/.nested-pgid-mismatch-target.XXXXXX")"
    printf '%s\n' "$pid" > "$nested_mismatch_tmp"
    ln "$nested_mismatch_tmp" "$nested_mismatch_target" 2>/dev/null || true
    rm -f -- "$nested_mismatch_tmp"
  fi
  if [[ -f "$nested_mismatch_target" && "$(<"$nested_mismatch_target")" == "$pid" ]]; then
    emitted_pgid="$((pid + 1))"
  fi
fi
if [[ "$emitted_pgid" == "$pid" && -f "$state/client-pgid-mismatch" ]] && \
  { [[ ! -f "$state/setsid-nested-pid" ]] || [[ "$(<"$state/setsid-nested-pid")" != "$pid" ]]; }; then
  client_mismatch_target="$state/client-pgid-mismatch-target"
  if [[ ! -f "$client_mismatch_target" ]]; then
    client_mismatch_tmp="$(mktemp "$state/.client-pgid-mismatch-target.XXXXXX")"
    printf '%s\n' "$pid" > "$client_mismatch_tmp"
    ln "$client_mismatch_tmp" "$client_mismatch_target" 2>/dev/null || true
    rm -f -- "$client_mismatch_tmp"
  fi
  if [[ -f "$client_mismatch_target" && "$(<"$client_mismatch_target")" == "$pid" ]]; then
    emitted_pgid="$((pid + 1))"
  fi
fi
printf 'requested_pid=%s\nemitted_pid=%s\nemitted_pgid=%s\nexit_status=%s\n' \
  "$pid" "$emitted_pid" "$emitted_pgid" "0" > "$state/ps-result"
printf ' %s %s\n' "$emitted_pid" "$emitted_pgid"
exit 0
EOF

  cat > "$FAKE_BIN/busctl" <<'EOF'
#!/usr/bin/env bash
printf 'busctl %s\n' "$*" >> "${FAKE_BUSCTL_LOG:?}"
exit 99
EOF

cat > "$FAKE_BIN/kill" <<'EOF'
#!/usr/bin/env bash
state="${FAKE_STATE_DIR:?}"
printf 'kill %s\n' "$*" >> "${FAKE_KILL_LOG:?}"
if [[ -f "${FAKE_STATE_DIR:?}/cleanup-verification-fail" && "$1" == "-TERM" && "$2" == "--" && "$3" == -* ]]; then
  exit 0
fi
if [[ "$#" -eq 2 && "$1" == "-0" && "$2" =~ ^[1-9][0-9]*$ ]]; then
  if [[ -f "$state/setsid-client-pids" ]]; then
    first_client="$(sed -n '1p' "$state/setsid-client-pids")"
    if [[ -n "$first_client" && "$2" != "$first_client" ]]; then
      for i in $(seq 1 40); do
        if [[ "$(sed -n '2p' "$state/setsid-client-pids")" == "$2" ]]; then
          if "${REAL_KILL_BIN:?}" "$@"; then
            : > "$state/clients-owned-and-live"
            exit 0
          else
            exit $?
          fi
        fi
        sleep 0.05
      done
    fi
    fi
  fi
exec "${REAL_KILL_BIN:?}" "$@"
EOF

  chmod +x "$FAKE_BIN/kwin_wayland" "$FAKE_BIN/weston-terminal" "$FAKE_BIN/dbus-run-session" \
    "$FAKE_BIN/gdbus" "$FAKE_BIN/cmake" "$FAKE_BIN/busctl" "$FAKE_BIN/kill" \
    "$FAKE_BIN/journalctl" "$FAKE_BIN/sleep" "$FAKE_BIN/setsid" "$FAKE_BIN/ps"
}

reset_state() {
  cleanup_nested_dead_leader_member
  rm -rf "$WORK/state" "$EVIDENCE_ROOT" "$HOST_RUNTIME" "$HOST_HOME"
  mkdir -p "$WORK/state" "$EVIDENCE_ROOT" "$HOST_RUNTIME" "$HOST_HOME"
  : > "$WORK/.live-native-effect-test-root"
  chmod 0700 "$HOST_RUNTIME"
  : > "$HOST_RUNTIME/wayland-0"
  : > "$WORK/calls.log"
  : > "$WORK/env.log"
  : > "$WORK/transitions.log"
  : > "$WORK/busctl.log"
  : > "$WORK/kill.log"
}

runner_env() {
  printf '%s\n' \
    "KWIN_WAYLAND_BIN=$FAKE_BIN/kwin_wayland" \
    "WESTON_TERMINAL_BIN=$FAKE_BIN/weston-terminal" \
    "DBUS_RUN_BIN=$FAKE_BIN/dbus-run-session" \
    "DBUS_CALL_BIN=$FAKE_BIN/gdbus" \
    "CMAKE_BIN=$FAKE_BIN/cmake" \
    "KILL_BIN=$FAKE_BIN/kill" \
    "SLEEP_BIN=$FAKE_BIN/sleep" \
    "SETSID_BIN=$FAKE_BIN/setsid" \
    "PS_BIN=$FAKE_BIN/ps" \
    "JOURNALCTL_BIN=$FAKE_BIN/journalctl" \
    "RUNNER_TEST_ONLY_EVIDENCE_OVERRIDE=1" \
    "RUNNER_TEST_ONLY_SOCKET_BYPASS=1" \
    "RUNNER_TEST_ROOT=$WORK" \
    "RUNNER_EVIDENCE_OVERRIDE=$EVIDENCE_ROOT" \
    "XDG_RUNTIME_DIR=$HOST_RUNTIME" \
    "WAYLAND_DISPLAY=wayland-0" \
    "HOME=$HOST_HOME" \
    "PATH=$FAKE_BIN:$PATH" \
    "FAKE_STATE_DIR=$WORK/state" \
    "FAKE_CALL_LOG=$WORK/calls.log" \
    "FAKE_ENV_LOG=$WORK/env.log" \
    "FAKE_TRANSITION_LOG=$WORK/transitions.log" \
    "FAKE_BUSCTL_LOG=$WORK/busctl.log" \
    "FAKE_KILL_LOG=$WORK/kill.log" \
    "HOST_RUNTIME=$HOST_RUNTIME" \
    "REAL_KILL_BIN=$REAL_KILL_BIN" \
    "REAL_SLEEP=$REAL_SLEEP" \
    "REAL_SETSID=$REAL_SETSID"
}

run_script() {
  set +e
  env $(runner_env) "$BASH_PATH" "$SCRIPT" "$@" >"$OUTPUT" 2>&1
  EXIT=$?
  set -e
}

run_bg() {
  set +e
  env $(runner_env) "$BASH_PATH" "$SCRIPT" "$@" >"$OUTPUT" 2>&1 &
  RUNNER_PID=$!
  set -e
}

wait_runner() {
  local completed_pid="" completed_status=0

  "$REAL_SLEEP" 20 &
  WATCHDOG_PID=$!
  set +e
  wait -n -p completed_pid "$RUNNER_PID" "$WATCHDOG_PID"
  completed_status=$?
  set -e
  if [[ "$completed_pid" == "$RUNNER_PID" ]]; then
    EXIT=$completed_status
    "$REAL_KILL_BIN" -TERM -- "$WATCHDOG_PID" 2>/dev/null || true
    set +e
    wait "$WATCHDOG_PID" 2>/dev/null
    set -e
    WATCHDOG_PID=""
    RUNNER_PID=""
  elif [[ "$completed_pid" == "$WATCHDOG_PID" ]]; then
    WATCHDOG_PID=""
    fail "runner did not exit after 20 seconds (pid $RUNNER_PID)"
    return 1
  else
    fail "wait returned an unexpected PID: ${completed_pid:-unset}"
    return 1
  fi
}

make_fake_tools

# Every generated boundary fake must parse before the harness exercises it.
for fake in "$FAKE_BIN"/*; do
  if "$BASH_PATH" -n "$fake"; then
    PASS=$((PASS + 1))
  else
    fail "generated fake has invalid Bash syntax: ${fake##*/}"
    exit 1
  fi
done

# All runner-controlled process and tool boundaries are forced to executable
# harness fakes before any fake-suite case runs. The setsid fake delegates only
# to the real session primitive for its private fake child, while logging it.
for boundary in KWIN_WAYLAND_BIN WESTON_TERMINAL_BIN DBUS_RUN_BIN DBUS_CALL_BIN CMAKE_BIN KILL_BIN SLEEP_BIN SETSID_BIN PS_BIN JOURNALCTL_BIN; do
  boundary_path="$(runner_env | sed -n "s/^$boundary=//p")"
  if [[ "$boundary_path" == "$FAKE_BIN/"* && -x "$boundary_path" ]]; then
    PASS=$((PASS + 1))
  else
    fail "runner boundary is not a fake executable: $boundary='$boundary_path'"
  fi
done

# Harness self-check: the fake /Effects bus and nested compositor must record
# transitions, environment, and process groups before any runner contract is
# exercised.
reset_state
FAKE_STATE_DIR="$WORK/state" FAKE_CALL_LOG="$WORK/calls.log" FAKE_ENV_LOG="$WORK/env.log" \
  FAKE_TRANSITION_LOG="$WORK/transitions.log" "$FAKE_BIN/gdbus" \
  call --address unix:path=/x --dest org.kde.KWin --object-path /Effects \
  --method org.kde.KWin.Effects.loadEffect "$PLUGIN_ID" >/dev/null 2>&1
if [[ "$(wc -l < "$WORK/transitions.log")" -eq 1 ]]; then
  PASS=$((PASS + 1))
else
  echo "FAIL: harness self-check failed (fake gdbus did not record a transition)" >&2
  FAIL=$((FAIL + 1))
fi

if [[ ! -f "$SCRIPT" ]]; then
  echo "FAIL: production command absent: $SCRIPT (intended unit-03 boundary)" >&2
  echo "passes: $PASS failures: $FAIL" >&2
  exit 1
fi

# Disallowed command absence: the runner never invokes a host busctl --user
# path, broad process matching, or a SIGKILL-style cleanup claim.
if grep -nE 'busctl[[:space:]]+--user|pkill|killall' "$SCRIPT" >/dev/null 2>&1; then
  echo "FAIL: runner invokes a disallowed broad/host operation" >&2
  grep -nE 'busctl[[:space:]]+--user|pkill|killall' "$SCRIPT" >&2
  FAIL=$((FAIL + 1))
else
  PASS=$((PASS + 1))
fi

# No SIGKILL/power-loss cleanup claim: the runner may document that SIGKILL is
# untrappable, but must never claim it cleans up after SIGKILL or power loss.
if grep -nE 'SIGKILL|power[- ]loss' "$SCRIPT" | grep -qiE 'clean|recover|restor|handl|remov'; then
  echo "FAIL: runner claims SIGKILL/power-loss cleanup" >&2
  grep -nE 'SIGKILL|power[- ]loss' "$SCRIPT" >&2
  FAIL=$((FAIL + 1))
else
  PASS=$((PASS + 1))
fi

# parsing: missing command fails with a clear message
reset_state
run_script
check_exit 1
assert_contains "missing command"

# parsing: unknown command fails closed
reset_state
run_script bogus
check_exit 1
assert_contains "unknown command"

# parsing: run rejects unknown arguments
reset_state
run_script run --bogus
check_exit 1
assert_contains "unknown run argument"

# parsing: --help documents the interface
reset_state
run_script --help
check_exit 0
assert_contains "run [--quick]"

# missing tool: a required tool that cannot be resolved refuses before any launch
reset_state
set +e
env $(runner_env) KWIN_WAYLAND_BIN="/nonexistent/kwin_wayland" "$BASH_PATH" "$SCRIPT" run >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 1
assert_contains "missing required tool"
assert_calls_not_contains "kwin_wayland --wayland-display"

# missing tool: weston-terminal refused before any launch
reset_state
set +e
env $(runner_env) WESTON_TERMINAL_BIN="/nonexistent/weston-terminal" "$BASH_PATH" "$SCRIPT" run >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 1
assert_contains "missing required tool"
assert_calls_not_contains "kwin_wayland --wayland-display"

# missing tool: cmake refused before any launch
reset_state
set +e
env $(runner_env) CMAKE_BIN="/nonexistent/cmake" "$BASH_PATH" "$SCRIPT" run >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 1
assert_contains "missing required tool"
assert_calls_not_contains "kwin_wayland --wayland-display"

# missing tool: dbus-run-session refused before any launch
reset_state
set +e
env $(runner_env) DBUS_RUN_BIN="/nonexistent/dbus-run-session" "$BASH_PATH" "$SCRIPT" run >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 1
assert_contains "missing required tool"
assert_calls_not_contains "kwin_wayland --wayland-display"

# missing tool: gdbus refused before any launch
reset_state
set +e
env $(runner_env) DBUS_CALL_BIN="/nonexistent/gdbus" "$BASH_PATH" "$SCRIPT" run >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 1
assert_contains "missing required tool"
assert_calls_not_contains "kwin_wayland --wayland-display"

# missing tool: an explicitly invalid KILL_BIN refuses before any launch
reset_state
set +e
env $(runner_env) KILL_BIN="/nonexistent/kill" "$BASH_PATH" "$SCRIPT" run >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 1
assert_contains "missing required tool"
assert_calls_not_contains "kwin_wayland --wayland-display"

# missing tool: a relative-but-executable KILL_BIN refuses before any launch
reset_state
mkdir -p "$WORK/rel-bin"
cp "$FAKE_BIN/kill" "$WORK/rel-bin/kill"
set +e
(
  cd "$WORK/rel-bin"
  env $(runner_env | grep -v '^KILL_BIN=') KILL_BIN="kill" "$BASH_PATH" "$SCRIPT" run >"$OUTPUT" 2>&1
)
EXIT=$?
set -e
check_exit 1
assert_contains "missing required tool"
assert_calls_not_contains "kwin_wayland --wayland-display"

# evidence override gate: the requested override refuses without the exact
# harness-only gate, before build, D-Bus, or nested-process launch.
reset_state
set +e
env $(runner_env) RUNNER_TEST_ONLY_EVIDENCE_OVERRIDE=0 RUNNER_EVIDENCE_OVERRIDE="$WORK/injected-evidence" \
  "$BASH_PATH" "$SCRIPT" run >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 1
assert_contains "runner evidence override requires RUNNER_TEST_ONLY_EVIDENCE_OVERRIDE=1"
assert_not_exists "$WORK/injected-evidence"
assert_calls_not_contains "cmake"
assert_calls_not_contains "gdbus"
assert_calls_not_contains "kwin_wayland --wayland-display"

# an explicitly gated override outside the harness root refuses before launch
reset_state
set +e
env $(runner_env) RUNNER_EVIDENCE_OVERRIDE="$FAKE_BIN" "$BASH_PATH" "$SCRIPT" run >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 1
assert_contains "harness evidence root must be under the private test root"
assert_calls_not_contains "kwin_wayland --wayland-display"

# host socket: an ordinary regular file refuses before any build or launch
reset_state
set +e
env $(runner_env) RUNNER_TEST_ONLY_SOCKET_BYPASS=0 "$BASH_PATH" "$SCRIPT" run >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 1
assert_contains "host Wayland socket is not a Unix socket"
assert_calls_not_contains "cmake"
assert_calls_not_contains "kwin_wayland --wayland-display"

# host socket: the socket-type bypass without the master test gate refuses
reset_state
set +e
env $(runner_env) RUNNER_TEST_ONLY_SOCKET_BYPASS=1 RUNNER_TEST_ONLY_EVIDENCE_OVERRIDE=0 RUNNER_EVIDENCE_OVERRIDE= \
  "$BASH_PATH" "$SCRIPT" run >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 1
assert_contains "runner socket bypass requires RUNNER_TEST_ONLY_EVIDENCE_OVERRIDE=1"
assert_calls_not_contains "cmake"
assert_calls_not_contains "kwin_wayland --wayland-display"

# host socket: a bypass path that canonically escapes the harness test root
# refuses before any build or launch
reset_state
ESCAPE_RUNTIME="$(mktemp -d)"
touch "$ESCAPE_RUNTIME/wayland-0"
ln -s "$ESCAPE_RUNTIME" "$WORK/escape-runtime"
set +e
env $(runner_env) XDG_RUNTIME_DIR="$WORK/escape-runtime" "$BASH_PATH" "$SCRIPT" run >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 1
assert_contains "harness socket must be under the private test root"
assert_calls_not_contains "cmake"
assert_calls_not_contains "kwin_wayland --wayland-display"
rm -rf "$ESCAPE_RUNTIME" "$WORK/escape-runtime"

# host socket: a private-root symlink leaf to an external regular file refuses
# before build or nested-process launch.
reset_state
EXTERNAL_SOCKET_FILE="$(mktemp)"
rm "$HOST_RUNTIME/wayland-0"
ln -s "$EXTERNAL_SOCKET_FILE" "$HOST_RUNTIME/wayland-0"
run_script run
check_exit 1
assert_contains "harness socket must not be a symlink"
assert_not_exists "$EVIDENCE_ROOT/build"
assert_calls_not_contains "cmake"
assert_calls_not_contains "kwin_wayland --wayland-display"
rm -f "$EXTERNAL_SOCKET_FILE"

# ABI/version: kwin_wayland --version is queried before the nested launch
reset_state
run_bg run
wait_for_clients
wait_for "$WORK/state/nested-ready"
touch "$WORK/state/client-stop"
wait_runner
check_exit 0
assert_calls_line_before "kwin_wayland --version" "kwin_wayland --wayland-display"
assert_calls_contains "cmake -S $REPO_ROOT/kwin/native-effect -B"

# ABI/version mismatch refuses before the nested launch
reset_state
touch "$WORK/state/abi-mismatch"
run_script run
check_exit 1
assert_contains "ABI"
assert_calls_not_contains "kwin_wayland --wayland-display"

# build failure refuses before the nested launch
reset_state
touch "$WORK/state/build-fail"
run_script run
check_exit 1
assert_calls_not_contains "kwin_wayland --wayland-display"

# success: private env roots, runtime 0700, absolute host socket, no --virtual,
# private child socket, private D-Bus, no busctl --user, exact plugin identity,
# exact /Effects transitions, two owned client groups, owned-only termination
reset_state
run_bg run
wait_for_clients
wait_for "$WORK/state/nested-ready"
touch "$WORK/state/client-stop"
wait_runner
check_exit 0
assert_env_private "KWIN_HOME"
assert_env_private "KWIN_KDEHOME"
assert_env_private "KWIN_XDG_CONFIG_HOME"
assert_env_private "KWIN_XDG_DATA_HOME"
assert_env_private "KWIN_XDG_CACHE_HOME"
assert_env_private "KWIN_XDG_STATE_HOME"
assert_env_private "KWIN_XDG_RUNTIME_DIR"
assert_env_private "KWIN_QT_PLUGIN_PATH"
COMPOSE="$(env_value KWIN_KWIN_COMPOSE)"
if [[ "$COMPOSE" == "O2" ]]; then
  PASS=$((PASS + 1))
else
  fail "nested compositor was not forced to OpenGL (KWIN_COMPOSE='$COMPOSE')"
fi
# The compositor-mode preflight marker is recorded before the nested launch:
# the fake kwin_wayland only copies its value once it has already been written.
PREFLIGHT="$(env_value KWIN_PREFLIGHT_COMPOSITOR)"
if [[ "$PREFLIGHT" == "O2" ]]; then
  PASS=$((PASS + 1))
else
  fail "compositor-mode preflight marker absent at launch (KWIN_PREFLIGHT_COMPOSITOR='$PREFLIGHT')"
fi
assert_file "$EVIDENCE_ROOT/preflight-compositor"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "preflight: compositor-mode=OpenGL kwin_compose=O2"
assert_all_private "CMAKE_HOME"
assert_all_private "CMAKE_KDEHOME"
assert_all_private "CMAKE_XDG_RUNTIME_DIR"
assert_env_private "CLIENT_HOME"
assert_env_private "CLIENT_KDEHOME"
assert_env_private "CLIENT_XDG_CONFIG_HOME"
assert_env_private "CLIENT_XDG_DATA_HOME"
assert_env_private "CLIENT_XDG_CACHE_HOME"
assert_env_private "CLIENT_XDG_STATE_HOME"
assert_env_private "CLIENT_XDG_RUNTIME_DIR"
RUNTIME_DIR="$(env_value KWIN_XDG_RUNTIME_DIR)"
if [[ -d "$RUNTIME_DIR" && "$(stat -c '%a' "$RUNTIME_DIR")" == "700" ]]; then
  PASS=$((PASS + 1))
else
  fail "private runtime dir is not mode 0700: '$RUNTIME_DIR'"
fi
assert_calls_contains "--wayland-display $HOST_RUNTIME/wayland-0"
assert_calls_not_contains "--virtual"
assert_calls_not_contains "--windowed"
NESTED_SOCKET="$(grep -oE -- '--socket [^ ]+' "$WORK/state/nested-argv" | head -1 | cut -d' ' -f2)"
if [[ -n "$NESTED_SOCKET" && "$(env_value KWIN_WAYLAND_DISPLAY)" == "$NESTED_SOCKET" && "$NESTED_SOCKET" != "wayland-0" ]]; then
  PASS=$((PASS + 1))
else
  fail "nested child socket not private: socket='$NESTED_SOCKET' display='$(env_value KWIN_WAYLAND_DISPLAY)'"
fi
DBUS_ADDR="$(env_value KWIN_DBUS)"
if [[ "$DBUS_ADDR" == unix:* && "$DBUS_ADDR" == *"$EVIDENCE_ROOT"* ]]; then
  PASS=$((PASS + 1))
else
  fail "nested D-Bus is not private: '$DBUS_ADDR'"
fi
QT_PLUGIN_PATH="$(env_value KWIN_QT_PLUGIN_PATH)"
PLUGIN_RESOLVED="$(env_value KWIN_PLUGIN_RESOLVED)"
EXPECTED_PLUGIN="$QT_PLUGIN_PATH/kwin/effects/plugins/$PLUGIN_ID.so"
if [[ -n "$PLUGIN_RESOLVED" && "$PLUGIN_RESOLVED" == "$EXPECTED_PLUGIN" && -f "$EXPECTED_PLUGIN" ]]; then
  PASS=$((PASS + 1))
else
  fail "nested process did not consume the exact private plugin layout: resolved='$PLUGIN_RESOLVED' expected='$EXPECTED_PLUGIN'"
fi
CLIENT_DISPLAYS="$(sed -n 's/^CLIENT_WAYLAND_DISPLAY=//p' "$WORK/env.log")"
CLIENT_DBUSES="$(sed -n 's/^CLIENT_DBUS=//p' "$WORK/env.log")"
if [[ "$(wc -l <<<"$CLIENT_DISPLAYS")" -eq 2 && -n "$NESTED_SOCKET" ]] && \
   [[ "$(sed -n '1p' <<<"$CLIENT_DISPLAYS")" == "$NESTED_SOCKET" ]] && \
   [[ "$(sed -n '2p' <<<"$CLIENT_DISPLAYS")" == "$NESTED_SOCKET" ]]; then
  PASS=$((PASS + 1))
else
  fail "clients do not both use the private child Wayland socket: '$(tr '\n' '|' <<<"$CLIENT_DISPLAYS")' vs '$NESTED_SOCKET'"
fi
if [[ "$(wc -l <<<"$CLIENT_DBUSES")" -eq 2 && -n "$DBUS_ADDR" ]] && \
   [[ "$(sed -n '1p' <<<"$CLIENT_DBUSES")" == "$DBUS_ADDR" ]] && \
   [[ "$(sed -n '2p' <<<"$CLIENT_DBUSES")" == "$DBUS_ADDR" ]]; then
  PASS=$((PASS + 1))
else
  fail "clients do not both use the private D-Bus address: '$(tr '\n' '|' <<<"$CLIENT_DBUSES")' vs '$DBUS_ADDR'"
fi
assert_not_exists "$WORK/state/dbus-user-violation"
if grep -Fq -- '--user' "$WORK/busctl.log"; then
  fail "busctl was invoked with --user"
else
  PASS=$((PASS + 1))
fi
assert_transitions "supportInformation $PLUGIN_ID
isEffectLoaded $PLUGIN_ID false
loadEffect $PLUGIN_ID
isEffectLoaded $PLUGIN_ID true
unloadEffect $PLUGIN_ID
isEffectLoaded $PLUGIN_ID false"
assert_calls_contains "unix:path=$EVIDENCE_ROOT/run/private-bus"
assert_calls_contains "--object-path /Effects"
assert_calls_not_contains "--session"
assert_calls_not_contains "--system"
assert_file_line "$EVIDENCE_ROOT/manifest.txt" "lifecycle: renderer transition result=verified renderer=gl2"
assert_file_line_before "$EVIDENCE_ROOT/transitions.log" \
  "dbus: renderer transition result=verified renderer=gl2" \
  "dbus: request method=supportInformation"
assert_calls_line_before \
  "gdbus call --address unix:path=$EVIDENCE_ROOT/run/private-bus --dest org.kde.KWin --object-path /Compositor --method org.freedesktop.DBus.Properties.Get org.kde.kwin.Compositing compositingType" \
  "gdbus call --address unix:path=$EVIDENCE_ROOT/run/private-bus --dest org.kde.KWin --object-path /Effects --method org.kde.KWin.Effects.supportInformation $PLUGIN_ID"
assert_file_contains "$EVIDENCE_ROOT/transitions.log" "dbus: request method=loadEffect address=unix:path=$EVIDENCE_ROOT/run/private-bus plugin=$PLUGIN_ID"
assert_file_contains "$EVIDENCE_ROOT/transitions.log" "dbus: result method=unloadEffect status=0 response=\(\)"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "cleanup verify group=client-a result=already-stopped"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "cleanup verify group=client-b result=already-stopped"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "cleanup verify group=nested result=gone"
NESTED_PID="$(<"$WORK/state/setsid-nested-pid")"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "ownership probe group=nested pid=$NESTED_PID ps_status=0 stdout_file=$EVIDENCE_ROOT/ownership-nested-ps.stdout.log stdout_capture_bytes="
assert_not_exists "$WORK/state/effect-loaded"
if [[ "$(wc -l < "$WORK/state/client-pids")" -eq 2 ]]; then
  PASS=$((PASS + 1))
else
  fail "expected exactly two owned clients, got $(wc -l < "$WORK/state/client-pids")"
fi
KWIN_PID="$(env_value KWIN_PID)"
KWIN_PGID="$(env_value KWIN_PGID)"
if [[ -n "$KWIN_PID" && "$KWIN_PID" == "$KWIN_PGID" ]]; then
  PASS=$((PASS + 1))
else
  fail "nested compositor is not in its own process group"
fi
CLIENT_PIDS="$(sed -n 's/^CLIENT_PID=//p' "$WORK/env.log")"
CLIENT_PGIDS="$(sed -n 's/^CLIENT_PGID=//p' "$WORK/env.log")"
if [[ "$CLIENT_PIDS" == "$CLIENT_PGIDS" && "$(wc -l <<<"$CLIENT_PIDS")" -eq 2 ]]; then
  PASS=$((PASS + 1))
else
  fail "clients are not each in their own process group"
fi
CLIENT_PID1="$(sed -n '1p' <<<"$CLIENT_PIDS")"
CLIENT_PID2="$(sed -n '2p' <<<"$CLIENT_PIDS")"
CLIENT_PGID1="$(sed -n '1p' <<<"$CLIENT_PGIDS")"
CLIENT_PGID2="$(sed -n '2p' <<<"$CLIENT_PGIDS")"
assert_calls_count "ps -o pid= -o pgid= -p $CLIENT_PID1" 1
assert_calls_count "ps -o pid= -o pgid= -p $CLIENT_PID2" 1
assert_kill_log_not_contains "kill -TERM -- -$CLIENT_PGID1"
assert_kill_log_not_contains "kill -TERM -- -$CLIENT_PGID2"

# unsupported effect refuses before load
reset_state
touch "$WORK/state/effect-unsupported"
run_script run
check_exit 1
assert_calls_not_contains "loadEffect"

# OpenGL unsupported refuses before load
reset_state
touch "$WORK/state/opengl-unsupported"
run_script run
check_exit 1
assert_calls_not_contains "loadEffect"

# OpenGL inactive (compositingType reports non-OpenGL) refuses before load
reset_state
touch "$WORK/state/opengl-inactive"
run_script run
check_exit 1
assert_calls_not_contains "loadEffect"

# initially loaded refuses before load
reset_state
touch "$WORK/state/effect-loaded"
run_script run
check_exit 1
assert_contains "already loaded"
assert_calls_not_contains "loadEffect"

# nested start failure: no false success, no load
reset_state
touch "$WORK/state/nested-start-fail"
run_script run
check_exit 1
assert_calls_not_contains "loadEffect"

# nested exit 0 before ready: fail closed, no false success
reset_state
touch "$WORK/state/nested-start-exit0"
run_script run
check_exit 1
assert_calls_not_contains "loadEffect"

# a client exits before both client groups are established: fail closed
reset_state
touch "$WORK/state/client-a-exits-early"
run_script run
check_exit 1
assert_not_contains "validated"
assert_calls_contains "unloadEffect"
assert_kill_log_contains "kill"

# A failed ownership probe retains its bounded stderr evidence and refuses
# before any ownership record or negative-PGID signal.
reset_state
touch "$WORK/state/ps-probe-fail"
run_bg run
wait_for "$WORK/state/setsid-nested-pid"
NESTED_PID="$(<"$WORK/state/setsid-nested-pid")"
UNACCEPTED_NESTED_PID="$NESTED_PID"
wait_runner
check_exit 1
assert_contains "could not establish nested launcher ownership"
assert_calls_contains "ps -o pid= -o pgid= -p $NESTED_PID"
assert_file_contains "$EVIDENCE_ROOT/ownership-nested-ps.stderr.log" "fake ps probe failure for pid $NESTED_PID"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "ownership probe group=nested pid=$NESTED_PID ps_status=42 stdout_file=$EVIDENCE_ROOT/ownership-nested-ps.stdout.log stdout_capture_bytes=0 stdout_capture_limit=4096 stdout_oversized=0 stdout='' stderr_file=$EVIDENCE_ROOT/ownership-nested-ps.stderr.log stderr=$'fake ps probe failure for pid $NESTED_PID\n'"
if kill -0 "$NESTED_PID" 2>/dev/null; then
  kill -TERM "$NESTED_PID" 2>/dev/null || true
  for i in $(seq 1 40); do
    kill -0 "$NESTED_PID" 2>/dev/null || break
    sleep 0.05
  done
fi
UNACCEPTED_NESTED_PID=""

# Oversized ownership stdout is retained only as the limit-plus-one capture,
# then refused before any negative-PGID signal can be issued.
reset_state
touch "$WORK/state/ps-oversized-stdout"
run_bg run
wait_for "$WORK/state/setsid-nested-pid"
NESTED_PID="$(<"$WORK/state/setsid-nested-pid")"
wait_runner
check_exit 1
assert_contains "could not establish nested launcher ownership"
assert_calls_contains "ps -o pid= -o pgid= -p $NESTED_PID"
assert_file "$EVIDENCE_ROOT/ownership-nested-ps.stdout.log"
assert_file_size_between "$EVIDENCE_ROOT/ownership-nested-ps.stdout.log" 4097 4097
assert_file_line "$WORK/state/ps-result" "exit_status=0"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "ownership probe group=nested pid=$NESTED_PID ps_status="
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "stdout_file=$EVIDENCE_ROOT/ownership-nested-ps.stdout.log"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "stdout_capture_bytes=4097 stdout_capture_limit=4096 stdout_oversized=1"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "ownership group=nested pid=$NESTED_PID result=refused reason=stdout-oversized"
assert_kill_log_not_contains "kill -TERM -- -"
if valid_positive_pid "$NESTED_PID" && "$REAL_KILL_BIN" -0 -- "$NESTED_PID" 2>/dev/null; then
  "$REAL_KILL_BIN" -TERM -- "$NESTED_PID" 2>/dev/null || true
  for i in $(seq 1 40); do
    "$REAL_KILL_BIN" -0 -- "$NESTED_PID" 2>/dev/null || break
    "$REAL_SLEEP" 0.05
  done
fi
rm -f "$WORK/state/ps-oversized-stdout"

# A capped probe refusal must not affect the following normal ownership probe.
reset_state
run_bg run
wait_for_clients
wait_for "$WORK/state/nested-ready"
touch "$WORK/state/client-stop"
wait_runner
check_exit 0
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "ownership probe group=nested"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "ps_status=0"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "stdout_capture_limit=4096 stdout_oversized=0"

# A nested PID/PGID mismatch is refused before ownership is recorded or any
# negative-PGID signal can be issued; the evidence remains available.
reset_state
touch "$WORK/state/nested-pgid-mismatch"
run_bg run
if NESTED_PID="$(wait_for_valid_positive_pid "$WORK/state/setsid-nested-pid")"; then
  UNACCEPTED_NESTED_PID="$NESTED_PID"
else
  fail "nested setsid PID was not atomically published"
fi
for i in $(seq 1 400); do
  if grep -Fq "could not establish nested launcher ownership" "$OUTPUT" && \
     grep -Fq "ownership group=nested pid=$NESTED_PID result=refused reason=pid-pgid-mismatch" "$EVIDENCE_ROOT/manifest.txt"; then
    break
  fi
  "$REAL_SLEEP" 0.05
done
if ! grep -Fq "could not establish nested launcher ownership" "$OUTPUT" || \
   ! grep -Fq "ownership group=nested pid=$NESTED_PID result=refused reason=pid-pgid-mismatch" "$EVIDENCE_ROOT/manifest.txt"; then
  fail "runner did not record nested ownership-refusal evidence"
fi
if [[ "$NESTED_PID" =~ ^[1-9][0-9]*$ ]] && "$REAL_KILL_BIN" -0 -- "$NESTED_PID" 2>/dev/null; then
  "$REAL_KILL_BIN" -TERM -- "$NESTED_PID" 2>/dev/null || true
  for i in $(seq 1 40); do
    "$REAL_KILL_BIN" -0 -- "$NESTED_PID" 2>/dev/null || break
    "$REAL_SLEEP" 0.05
  done
fi
wait_runner
check_exit 1
assert_contains "could not establish nested launcher ownership"
assert_file_line "$WORK/state/nested-pgid-mismatch-target" "$NESTED_PID"
if ! "$REAL_KILL_BIN" -0 -- "$NESTED_PID" 2>/dev/null; then
  UNACCEPTED_NESTED_PID=""
else
  fail "unaccepted nested PID remained alive after runner reap: $NESTED_PID"
fi
assert_calls_contains "setsid $FAKE_BIN/kwin_wayland"
assert_calls_count "ps -o pid= -o pgid= -p $NESTED_PID" 10
assert_kill_log_not_contains "kill -TERM -- -$((NESTED_PID + 1))"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "ownership probe group=nested pid=$NESTED_PID ps_status=0 stdout_file=$EVIDENCE_ROOT/ownership-nested-ps.stdout.log stdout_capture_bytes="
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "ownership group=nested pid=$NESTED_PID result=refused reason=pid-pgid-mismatch"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "ownership establishment group=nested pid=$NESTED_PID attempts=10 final=refused reason=probe-never-verified"

# A client PID/PGID mismatch is refused without signalling the unowned group;
# its refusal evidence remains while the previously recorded nested group is
# still cleaned up through its independently verified ownership.
reset_state
touch "$WORK/state/client-pgid-mismatch"
run_bg run
if CLIENT_PID="$(wait_for_valid_positive_pid "$WORK/state/client-pgid-mismatch-target")"; then
  :
else
  fail "client mismatch target was not atomically published"
  CLIENT_PID=1
fi
touch "$WORK/state/client-stop"
wait_runner
check_exit 1
assert_contains "could not establish client-a ownership"
assert_calls_contains "setsid $FAKE_BIN/weston-terminal"
assert_calls_contains "ps -o pid= -o pgid= -p $CLIENT_PID"
assert_kill_log_not_contains "kill -TERM -- -$((CLIENT_PID + 1))"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "ownership group=client-a pid=$CLIENT_PID result=refused reason=pid-pgid-mismatch"

# interruption during start: no load, owned cleanup, no false success
reset_state
touch "$WORK/state/nested-block-start"
if [[ -z "$REAL_TIMEOUT" ]]; then
  echo "SKIP interrupt-during-start: timeout not found" >&2
else
  set +e
  env $(runner_env) "$REAL_TIMEOUT" --preserve-status -s TERM 3 "$BASH_PATH" "$SCRIPT" run >"$OUTPUT" 2>&1
  EXIT=$?
  set -e
  check_exit 143
  assert_calls_not_contains "loadEffect"
  assert_not_contains "validated"
fi

# nested crash after start: no false success, owned cleanup
reset_state
run_bg run
wait_for "$WORK/state/nested-ready"
touch "$WORK/state/nested-crash"
wait_runner
check_exit 1
assert_not_contains "validated"
assert_calls_contains "unloadEffect"
assert_kill_log_contains "kill"

# TERM cleanup: living owned groups are freshly revalidated before termination.
reset_state
run_bg run
wait_for_effect_load
wait_for_clients
"$REAL_KILL_BIN" -TERM -- "$RUNNER_PID"
wait_runner
check_exit 143
assert_transitions "supportInformation $PLUGIN_ID
isEffectLoaded $PLUGIN_ID false
loadEffect $PLUGIN_ID
isEffectLoaded $PLUGIN_ID true
unloadEffect $PLUGIN_ID
isEffectLoaded $PLUGIN_ID false"
assert_file_line_before "$EVIDENCE_ROOT/manifest.txt" \
  "lifecycle: cleanup unload result=verified-unloaded" \
  "lifecycle: cleanup revalidate group=client-a result=verified pid=$(sed -n 's/^client_a_pid=//p' "$EVIDENCE_ROOT/owned-pids") pgid=$(sed -n 's/^client_a_pgid=//p' "$EVIDENCE_ROOT/owned-pids")"
assert_file_line_before "$EVIDENCE_ROOT/manifest.txt" \
  "lifecycle: cleanup request group=client-a pid=$(sed -n 's/^client_a_pid=//p' "$EVIDENCE_ROOT/owned-pids") pgid=$(sed -n 's/^client_a_pgid=//p' "$EVIDENCE_ROOT/owned-pids")" \
  "lifecycle: cleanup request group=client-b pid=$(sed -n 's/^client_b_pid=//p' "$EVIDENCE_ROOT/owned-pids") pgid=$(sed -n 's/^client_b_pgid=//p' "$EVIDENCE_ROOT/owned-pids")"
assert_file_line_before "$EVIDENCE_ROOT/manifest.txt" \
  "lifecycle: cleanup request group=client-b pid=$(sed -n 's/^client_b_pid=//p' "$EVIDENCE_ROOT/owned-pids") pgid=$(sed -n 's/^client_b_pgid=//p' "$EVIDENCE_ROOT/owned-pids")" \
  "lifecycle: cleanup request group=nested pid=$(sed -n 's/^nested_pid=//p' "$EVIDENCE_ROOT/owned-pids") pgid=$(sed -n 's/^nested_pgid=//p' "$EVIDENCE_ROOT/owned-pids")"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "cleanup complete"

# INT cleanup (Ctrl-C): unload and owned termination
if [[ -z "$REAL_TIMEOUT" ]]; then
  echo "SKIP INT cleanup: timeout not found" >&2
else
  reset_state
  set +e
  env $(runner_env) "$REAL_TIMEOUT" --signal=INT --preserve-status 60 "$BASH_PATH" "$SCRIPT" run >"$OUTPUT" 2>&1 &
  TIMEOUT_PID=$!
  set -e
  wait_for_effect_load
  wait_for_clients
  wait_for_session_pid
  assert_file_line "$EVIDENCE_ROOT/manifest.txt" "session_pid=$INT_SESSION_PID"
  "$REAL_KILL_BIN" -ALRM -- "$TIMEOUT_PID"
  if valid_positive_pid "$TIMEOUT_PID"; then
    set +e
    wait "$TIMEOUT_PID"
    EXIT=$?
    set -e
    TIMEOUT_PID=""
  fi
  INT_SESSION_PID=""
  check_exit 130
  assert_transitions "supportInformation $PLUGIN_ID
isEffectLoaded $PLUGIN_ID false
loadEffect $PLUGIN_ID
isEffectLoaded $PLUGIN_ID true
unloadEffect $PLUGIN_ID
isEffectLoaded $PLUGIN_ID false"
  assert_file_line_before "$EVIDENCE_ROOT/manifest.txt" \
    "lifecycle: cleanup unload result=verified-unloaded" \
    "lifecycle: cleanup revalidate group=client-a result=verified pid=$(sed -n 's/^client_a_pid=//p' "$EVIDENCE_ROOT/owned-pids") pgid=$(sed -n 's/^client_a_pgid=//p' "$EVIDENCE_ROOT/owned-pids")"
  assert_file_line_before "$EVIDENCE_ROOT/manifest.txt" \
    "lifecycle: cleanup request group=client-a pid=$(sed -n 's/^client_a_pid=//p' "$EVIDENCE_ROOT/owned-pids") pgid=$(sed -n 's/^client_a_pgid=//p' "$EVIDENCE_ROOT/owned-pids")" \
    "lifecycle: cleanup request group=client-b pid=$(sed -n 's/^client_b_pid=//p' "$EVIDENCE_ROOT/owned-pids") pgid=$(sed -n 's/^client_b_pgid=//p' "$EVIDENCE_ROOT/owned-pids")"
  assert_file_line_before "$EVIDENCE_ROOT/manifest.txt" \
    "lifecycle: cleanup request group=client-b pid=$(sed -n 's/^client_b_pid=//p' "$EVIDENCE_ROOT/owned-pids") pgid=$(sed -n 's/^client_b_pgid=//p' "$EVIDENCE_ROOT/owned-pids")" \
    "lifecycle: cleanup request group=nested pid=$(sed -n 's/^nested_pid=//p' "$EVIDENCE_ROOT/owned-pids") pgid=$(sed -n 's/^nested_pgid=//p' "$EVIDENCE_ROOT/owned-pids")"
  assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "cleanup complete"
fi

# owned-only termination: reaped clients are never signalled, the living nested
# group is signalled once, and the decoy is never targeted.
reset_state
DECOY=0
sleep 300 &
DECOY=$!
run_bg run
wait_for_clients
wait_for "$WORK/state/nested-ready"
touch "$WORK/state/client-stop"
wait_runner
check_exit 0
if kill -0 "$DECOY" 2>/dev/null; then
  PASS=$((PASS + 1))
else
  fail "decoy process was terminated by the runner"
fi
if grep -Fq "$DECOY" "$WORK/kill.log"; then
  fail "unrelated process was terminated"
else
  PASS=$((PASS + 1))
fi
if grep -Fq -- 'kill -9' "$WORK/kill.log"; then
  fail "runner used SIGKILL"
else
  PASS=$((PASS + 1))
fi
KWIN_PGID="$(env_value KWIN_PGID)"
CLIENT_PGID1="$(sed -n 's/^CLIENT_PGID=//p' "$WORK/env.log" | sed -n '1p')"
CLIENT_PGID2="$(sed -n 's/^CLIENT_PGID=//p' "$WORK/env.log" | sed -n '2p')"
KILL_TOKENS="$(grep -E -- 'kill -TERM -- -[0-9]+$' "$WORK/kill.log" | grep -oE -- '-[0-9]+$')"
if [[ -n "$KWIN_PGID" && "$(printf '%s\n' "$KILL_TOKENS" | grep -Fxc -- "-$KWIN_PGID")" -eq 1 ]] && \
   [[ "$(printf '%s\n' "$KILL_TOKENS" | grep -Fxc -- "-$CLIENT_PGID1")" -eq 0 ]] && \
   [[ "$(printf '%s\n' "$KILL_TOKENS" | grep -Fxc -- "-$CLIENT_PGID2")" -eq 0 ]]; then
  PASS=$((PASS + 1))
else
  fail "cleanup signalled a reaped client or did not signal the living nested group"
fi
if grep -Fq "cleanup verify group=client-a result=already-stopped" "$EVIDENCE_ROOT/manifest.txt" && \
   grep -Fq "cleanup verify group=client-b result=already-stopped" "$EVIDENCE_ROOT/manifest.txt"; then
  PASS=$((PASS + 1))
else
  fail "cleanup did not record reaped clients as already stopped"
fi
kill "$DECOY" 2>/dev/null || true

# default tool lookup: with KILL_BIN unset, the executable PATH lookup resolves
# the fake kill. The manifest records the absolute kill_bin, fake-kill boundary
# observability stays active, and no unattributed process is signalled.
reset_state
DECOY=0
sleep 300 &
DECOY=$!
set +e
env $(runner_env | grep -v '^KILL_BIN=') "$BASH_PATH" "$SCRIPT" run >"$OUTPUT" 2>&1 &
RUNNER_PID=$!
set -e
wait_for_clients
wait_for "$WORK/state/nested-ready"
touch "$WORK/state/client-stop"
wait_runner
check_exit 0
assert_file_line "$EVIDENCE_ROOT/manifest.txt" "kill_bin=$FAKE_BIN/kill"
assert_kill_log_contains "kill -0"
if kill -0 "$DECOY" 2>/dev/null; then
  PASS=$((PASS + 1))
else
  fail "decoy process was terminated by the runner"
fi
if grep -Fq "$DECOY" "$WORK/kill.log"; then
  fail "unrelated process was terminated"
else
  PASS=$((PASS + 1))
fi
kill "$DECOY" 2>/dev/null || true

# optional journal: the fake is queried read-only for the exact nested PID and
# current attempt interval; its output and invocation remain available to these assertions.
reset_state
run_bg run
wait_for_clients
wait_for "$WORK/state/nested-ready"
touch "$WORK/state/client-stop"
wait_runner
check_exit 0
assert_file "$EVIDENCE_ROOT/journal.log"
KWIN_PID="$(env_value KWIN_PID)"
assert_calls_contains "journalctl --no-pager --output=short-iso --since @"
assert_calls_contains "_PID=$KWIN_PID"
assert_calls_not_contains "journalctl --follow"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "journal captured pid=$KWIN_PID"
assert_file_contains "$EVIDENCE_ROOT/journal.log" "_PID=$KWIN_PID"
assert_file "$EVIDENCE_ROOT/kwin-version.log"
assert_file_contains "$EVIDENCE_ROOT/kwin-version.log" "kwin 6.7.3"
assert_file_contains "$EVIDENCE_ROOT/cmake-configure.log" "fake configure complete"
assert_file_contains "$EVIDENCE_ROOT/cmake-build.log" "fake build complete"
if [[ -d "$EVIDENCE_ROOT" ]]; then
  PASS=$((PASS + 1))
else
  fail "evidence root was removed"
fi

# unavailable journal evidence is recorded but does not fail the otherwise valid run.
reset_state
touch "$WORK/state/journal-unavailable"
run_bg run
wait_for_clients
wait_for "$WORK/state/nested-ready"
touch "$WORK/state/client-stop"
wait_runner
check_exit 0
assert_calls_contains "journalctl --no-pager --output=short-iso"
assert_not_exists "$EVIDENCE_ROOT/journal.log"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "journal unavailable"

# --quick changes only the checklist observation window; lifecycle evidence and
# all readiness checks remain present.
reset_state
run_bg run --quick
wait_for_clients
wait_for "$WORK/state/nested-ready"
touch "$WORK/state/client-stop"
wait_runner
check_exit 0
assert_calls_contains "sleep 0.1"
assert_calls_not_contains "sleep 2"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "checklist observation wait=0.1s"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "cleanup complete"

# A fake post-termination probe can report a remaining owned group. The runner
# records and surfaces that failed verification instead of claiming success.
reset_state
touch "$WORK/state/cleanup-verification-fail"
run_bg run
wait_for_clients
wait_for "$WORK/state/nested-ready"
touch "$WORK/state/client-stop"
wait_runner
check_exit 1
assert_contains "owned cleanup verification failed"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "cleanup verify group=nested result=remaining"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "cleanup failed"
NESTED_PID="$(<"$WORK/state/setsid-nested-pid")"
if valid_positive_pid "$NESTED_PID" && "$REAL_KILL_BIN" -0 -- "$NESTED_PID" 2>/dev/null; then
  "$REAL_KILL_BIN" -TERM -- "$NESTED_PID" 2>/dev/null || true
  for i in $(seq 1 40); do
    "$REAL_KILL_BIN" -0 -- "$NESTED_PID" 2>/dev/null || break
    "$REAL_SLEEP" 0.05
  done
  if "$REAL_KILL_BIN" -0 -- "$NESTED_PID" 2>/dev/null; then
    "$REAL_KILL_BIN" -KILL -- "$NESTED_PID" 2>/dev/null || true
  fi
fi
assert_kill_log_not_contains "kill -TERM -- $NESTED_PID"

# A negative PGID can remain after its recorded leader is gone. The runner must
# refuse without signalling that extant, unprovable group.
reset_state
touch "$WORK/state/nested-leader-exits-with-group"
run_bg run
wait_for_clients
wait_for "$WORK/state/nested-ready"
touch "$WORK/state/client-stop"
wait_for "$WORK/state/nested-dead-leader-member-pid"
wait_runner
check_exit 1
NESTED_PID="$(<"$WORK/state/setsid-nested-pid")"
NESTED_PGID="$(env_value KWIN_PGID)"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "cleanup revalidate group=nested result=unverified"
assert_file_contains "$EVIDENCE_ROOT/manifest.txt" "cleanup group=nested result=ownership-unverified"
assert_kill_log_contains "kill -0 -- -$NESTED_PGID"
assert_kill_log_not_contains "kill -TERM -- -$NESTED_PGID"
assert_calls_count "ps -o pid= -o pgid= -p $NESTED_PID" 2

echo "passes: $PASS failures: $FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
