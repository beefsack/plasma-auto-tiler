#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/live-test.sh"
FAKE_BIN="$(mktemp -d)"
WORK="$(mktemp -d)"
OUTPUT="$(mktemp)"
LIVE_ROOT="$WORK/live-root"
LIVE_BASE="$LIVE_ROOT/plasma-auto-tiler-live"
FAKE_DOGFOOD="$WORK/dogfood-install.sh"
FAKE_START_TEST="$WORK/start-test.sh"
PASS=0
FAIL=0
EXIT=0

cleanup() {
  rm -rf "$FAKE_BIN"
  rm -rf "$WORK"
  rm -f "$OUTPUT"
}
trap cleanup EXIT

REAL_JQ="$(command -v jq || true)"
REAL_TIMEOUT="$(command -v timeout || true)"
BASH_PATH="$(command -v bash)"

if [[ -z "$REAL_JQ" ]]; then
  echo "FAIL: jq not found in PATH; live-test follow filtering delegates to it" >&2
  exit 1
fi

make_fake_tools() {
  mkdir -p "$FAKE_BIN/bin"

  cat > "$FAKE_BIN/bin/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'npm %s\n' "$*" >> "${FAKE_TOOL_LOG:?}"
if [[ -f "${FAKE_STATE_DIR:?}/npm-fail" ]]; then
  echo "fake npm: simulated failure" >&2
  exit 1
fi
if [[ "$*" == *test* && -f "${FAKE_STATE_DIR:?}/npm-test-fail" ]]; then
  echo "fake npm: simulated test failure" >&2
  exit 1
fi
exit 0
EOF

  cat > "$FAKE_BIN/bin/pgrep" <<'EOF'
#!/usr/bin/env bash
printf '2517 /nix/store/kwin-6.7.3/bin/kwin_wayland --wayland-fd 7 --socket wayland-0\n'
EOF

  cat > "$FAKE_BIN/bin/journalctl" <<'EOF'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"--show-cursor"* ]]; then
  printf '%s\n' "-- cursor: cursor-live"
elif [[ "$args" == *" -f"* ]]; then
  printf 'follow-started\n' > "${FAKE_STATE_DIR:?}/follow-marker"
  if [[ -f "${FAKE_STATE_DIR:?}/follow-block" ]]; then
    sleep 30
    exit 0
  fi
  printf '{"_PID":"2517","MESSAGE":"plasma-auto-tiler:keyboard-completed"}\n'
  printf '{"_PID":"2517","SYSLOG_IDENTIFIER":"kwin_scripting","MESSAGE":"script evaluation error"}\n'
  exit 0
else
  exit 0
fi
EOF

  cat > "$FAKE_DOGFOOD" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state="${FAKE_STATE_DIR:?}"
cmd="${1:-}"
printf 'dogfood %s\n' "$cmd" >> "${FAKE_CALL_LOG:?}"
case "$cmd" in
  status)
    if [[ -f "$state/installed-bogus" ]]; then
      printf 'installed: maybe\n'
    else
      installed="no"
       [[ -f "$state/installed" ]] && installed="yes (/fake/kwin/scripts/plasma-auto-tiler-kwin)"
      printf 'installed: %s\n' "$installed"
    fi
    if [[ -f "$state/enabled-bogus" ]]; then
      printf 'enabled: maybe\n'
    else
      enabled="no"
      [[ -f "$state/enabled" ]] && enabled="yes"
      printf 'enabled: %s\n' "$enabled"
    fi
    printf 'note: status is read-only and never reconfigures KWin.\n'
    ;;
  enable)
    if [[ -f "$state/enable-fail" ]]; then
      echo "error: fake enable failed" >&2
      exit 1
    fi
    touch "$state/enabled"
    printf 'enabled: plasma-auto-tiler-kwinEnabled set to true and KWin reconfigured\n'
    ;;
  disable)
    if [[ -f "$state/disable-fail" ]]; then
      echo "error: fake disable failed" >&2
      exit 1
    fi
    rm -f "$state/enabled"
    printf 'disabled: plasma-auto-tiler-kwinEnabled set to false and KWin reconfigured\n'
    ;;
esac
EOF

  cat > "$FAKE_START_TEST" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
READINESS_ATTEMPTS=30
READINESS_DELAY=0.1
state="${FAKE_STATE_DIR:?}"
cmd="${1:-}"
printf 'start-test %s\n' "$cmd" >> "${FAKE_CALL_LOG:?}"
case "$cmd" in
  status)
    if [[ -f "$state/status-fail" ]]; then
      echo "error: fake status failed" >&2
      exit 1
    fi
    if [[ -f "$state/loaded-bogus" ]]; then
      printf 'loaded: bogus\n'
    elif [[ -f "$state/loaded" ]]; then
      printf 'loaded: loaded\n'
    else
      printf 'loaded: not-loaded\n'
    fi
    printf 'controller running/callbacks: not proven\n'
    printf 'project action records (KGlobalAccel): 0\n'
    ;;
  start)
    if [[ -f "$state/start-disabled" ]]; then
      printf 'controller diagnostics (current attempt, after-cursor, same-KWin-PID):\n' >&2
      printf '  plasma-auto-tiler:disabled:shortcut-registration-failed\n' >&2
      printf '  plasma-auto-tiler:shortcut-register-failed:plasma-auto-tiler-focus-left\n' >&2
      printf 'error: controller disabled itself during startup\n' >&2
      exit 1
    fi
    if [[ -f "$state/start-block" ]]; then
      sleep 30
      exit 0
    fi
    if [[ -f "$state/start-fail" ]]; then
      echo "error: fake start failed" >&2
      exit 1
    fi
    printf 'started: plugin plasma-auto-tiler-kwin loaded; controller readiness confirmed\n'
    ;;
  stop)
    printf 'stop: plugin plasma-auto-tiler-kwin unloaded\n'
    ;;
  diagnostics)
    printf 'diagnostics epoch: current\n'
    ;;
  desktops)
    printf 'virtual desktops: 2\n'
    ;;
esac
EOF

  chmod +x "$FAKE_BIN/bin/npm" "$FAKE_BIN/bin/pgrep" "$FAKE_BIN/bin/journalctl" "$FAKE_DOGFOOD" "$FAKE_START_TEST"
}

reset_state() {
  rm -rf "$WORK/state" "$LIVE_ROOT"
  mkdir -p "$WORK/state" "$LIVE_ROOT"
  : > "$WORK/calls.log"
  : > "$WORK/tools.log"
}

run_script() {
  set +e
  DOGFOOD_SH="$FAKE_DOGFOOD" START_TEST_SH="$FAKE_START_TEST" \
    NPM_BIN="$FAKE_BIN/bin/npm" PGREP_BIN="$FAKE_BIN/bin/pgrep" \
    JOURNALCTL_BIN="$FAKE_BIN/bin/journalctl" JQ_BIN="$REAL_JQ" \
    LIVE_TEST_ROOT="$LIVE_ROOT" PATH="$FAKE_BIN/bin:$PATH" \
    FAKE_STATE_DIR="$WORK/state" FAKE_CALL_LOG="$WORK/calls.log" FAKE_TOOL_LOG="$WORK/tools.log" \
    "$BASH_PATH" "$SCRIPT" "$@" >"$OUTPUT" 2>&1
  EXIT=$?
  set -e
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
  local needle="$1"
  if grep -Fq "$needle" "$WORK/calls.log"; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: calls.log does not contain '$needle'" >&2
    cat "$WORK/calls.log" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_calls_not_contains() {
  local needle="$1"
  if grep -Fq "$needle" "$WORK/calls.log"; then
    echo "FAIL: calls.log unexpectedly contains '$needle'" >&2
    cat "$WORK/calls.log" >&2
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
}

assert_tools_contains() {
  local needle="$1"
  if grep -Fq "$needle" "$WORK/tools.log"; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: tools.log does not contain '$needle'" >&2
    cat "$WORK/tools.log" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_tools_not_contains() {
  local needle="$1"
  if grep -Fq "$needle" "$WORK/tools.log"; then
    echo "FAIL: tools.log unexpectedly contains '$needle'" >&2
    cat "$WORK/tools.log" >&2
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
}

assert_call_count() {
  local expected="$1" needle="$2"
  local n
  n="$(grep -cF "$needle" "$WORK/calls.log" || true)"
  if [[ "$n" -eq "$expected" ]]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: expected $expected '$needle' call(s), got $n" >&2
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

assert_not_exists() {
  if [[ ! -e "$1" ]]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: unexpected path '$1'" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_file_contains() {
  local file="$1" needle="$2"
  if [[ -f "$file" ]] && grep -Fq "$needle" "$file"; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: file '$file' does not contain '$needle'" >&2
    FAIL=$((FAIL + 1))
  fi
}

make_fake_tools

# parsing: missing command fails with a clear message
reset_state
run_script
check_exit 1
assert_contains "error: missing command (run)"

# parsing: unknown command fails closed
reset_state
run_script bogus
check_exit 1
assert_contains "error: unknown command 'bogus'"

# parsing: --help documents the interface and the kill -9 residual
reset_state
run_script --help
check_exit 0
assert_contains "usage: live-test.sh <command> [--help]"
assert_contains "run --quick"
assert_contains "SIGKILL (-9) cannot be trapped"

# parsing: run rejects too many arguments
reset_state
run_script run a b c
check_exit 1
assert_contains "takes at most two arguments"

# parsing: run rejects unknown arguments
reset_state
run_script run --bogus
check_exit 1
assert_contains "unknown run argument '--bogus'"

# parsing: run rejects an unknown combined argument
reset_state
run_script run --quick --bogus
check_exit 1
assert_contains "unknown run argument '--bogus'"

# parsing: --quick and --verbose combine deterministically in either order
reset_state
run_script run --quick --verbose
check_exit 0
assert_contains "=== preflight (quick) ==="
assert_tools_not_contains "npm test"
assert_contains "preflight: typecheck pass"

reset_state
run_script run --verbose --quick
check_exit 0
assert_contains "=== preflight (quick) ==="
assert_tools_not_contains "npm test"

# disallowed command absence: the runner never invokes a forbidden live
# mutation or broad-cleanup operation
if grep -nE 'reconcile-shortcuts|setShortcutKeys|createDesktop|createWindow|systemd-run|--windowed|qdbus|kwriteconfig6|(^|[[:space:]])kill([[:space:]]|$)' "$SCRIPT" >/dev/null 2>&1; then
  echo "FAIL: live-test.sh invokes a disallowed live mutation" >&2
  grep -nE 'reconcile-shortcuts|setShortcutKeys|createDesktop|createWindow|systemd-run|--windowed|qdbus|kwriteconfig6|(^|[[:space:]])kill([[:space:]]|$)' "$SCRIPT" >&2
  FAIL=$((FAIL + 1))
else
  PASS=$((PASS + 1))
fi

# success (full preflight): runs start, follows logs, cleans up, retains evidence
reset_state
run_script run
check_exit 0
assert_contains "=== preflight (full) ==="
assert_tools_contains "npm run typecheck"
assert_tools_contains "npm run build"
assert_tools_contains "npm test"
assert_contains "=== installed-plugin state (read-only) ==="
assert_contains "installed: no"
assert_contains "enabled: no"
assert_contains "=== direct controller status (read-only) ==="
assert_contains "loaded: not-loaded"
assert_contains "kwin pid: 2517"
assert_contains "=== controller status/diagnostics/desktops ==="
assert_contains "=== checklist ==="
assert_contains "=== following live same-KWin-PID project and kwin_scripting logs (Ctrl-C to stop) ==="
assert_contains "=== live-test run live-" # prefix of the run nonce
assert_contains "=== final: stopping the directly loaded script ==="
assert_contains "evidence retained at:"
assert_call_count 1 "start-test start"
assert_call_count 1 "start-test stop"
assert_calls_contains "start-test diagnostics"
assert_calls_contains "start-test desktops"
assert_calls_not_contains "dogfood disable"
assert_calls_not_contains "dogfood enable"
assert_not_exists "$LIVE_BASE/.lock"
# evidence retained under the nonce-owned directory
if [[ "$(find "$LIVE_BASE" -name final-status.txt | wc -l)" -ne 1 ]]; then
  echo "FAIL: expected exactly one retained final-status.txt" >&2
  find "$LIVE_BASE" >&2
  FAIL=$((FAIL + 1))
else
  PASS=$((PASS + 1))
fi
assert_file "$(find "$LIVE_BASE" -name plasma-auto-tiler.log | head -1)"
assert_file "$(find "$LIVE_BASE" -name kwin_scripting.log | head -1)"
assert_file "$(find "$LIVE_BASE" -name kwin-follow.jsonl | head -1)"

# quick: skips the full test suite but still typechecks, builds, and static-scans
reset_state
run_script run --quick
check_exit 0
assert_contains "=== preflight (quick) ==="
assert_tools_contains "npm run typecheck"
assert_tools_contains "npm run build"
assert_tools_not_contains "npm test"
assert_contains "=== checklist ==="
assert_call_count 1 "start-test start"

# installed and enabled: disable before start, restore and verify on exit
reset_state
touch "$WORK/state/installed"
touch "$WORK/state/enabled"
run_script run
check_exit 0
assert_contains "disabled installed plugin (was enabled); will restore on exit"
assert_contains "=== final: restoring installed-plugin enable state ==="
assert_contains "restore verified: plugin enabled again"
assert_calls_contains "dogfood disable"
assert_calls_contains "dogfood enable"
assert_call_count 1 "dogfood disable"
assert_call_count 1 "dogfood enable"
assert_file "$WORK/state/enabled"
assert_not_exists "$LIVE_BASE/.lock"

# initially disabled: never enables, never disables
reset_state
run_script run
check_exit 0
assert_calls_not_contains "dogfood disable"
assert_calls_not_contains "dogfood enable"
assert_not_exists "$WORK/state/enabled"

# disabled reason: start failure reports the attempt diagnostics, never
# retries, and cleanup still stops the attempted-but-unconfirmed load
reset_state
touch "$WORK/state/start-disabled"
run_script run
check_exit 1
assert_contains "plasma-auto-tiler:disabled:shortcut-registration-failed"
assert_contains "plasma-auto-tiler:shortcut-register-failed:plasma-auto-tiler-focus-left"
assert_contains "start-test.sh start failed (exit status 1)"
assert_contains "start transcript retained at:"
assert_contains "not retrying"
assert_call_count 1 "start-test start"
assert_call_count 1 "start-test stop"
assert_calls_not_contains "dogfood enable"
assert_not_exists "$LIVE_BASE/.lock"
assert_file "$(find "$LIVE_BASE" -name start.txt | head -1)"
assert_file_contains "$(find "$LIVE_BASE" -name final-stop.txt | head -1)" "stop: plugin plasma-auto-tiler-kwin unloaded"

# failure restoration: a disabled start still restores the plugin enable state
reset_state
touch "$WORK/state/installed"
touch "$WORK/state/enabled"
touch "$WORK/state/start-disabled"
run_script run
check_exit 1
assert_contains "restore verified: plugin enabled again"
assert_calls_contains "dogfood disable"
assert_calls_contains "dogfood enable"
assert_file "$WORK/state/enabled"

# command failure: a preflight build/typecheck failure fails closed before any load
reset_state
touch "$WORK/state/npm-fail"
run_script run
check_exit 1
assert_contains "npm typecheck failed"
assert_calls_not_contains "start-test start"
assert_calls_not_contains "dogfood disable"

# command failure: a full-suite test failure fails closed
reset_state
touch "$WORK/state/npm-test-fail"
run_script run
check_exit 1
assert_contains "npm test failed"
assert_calls_not_contains "start-test start"

# fail closed when the controller is already loaded and cannot be safely owned
reset_state
touch "$WORK/state/loaded"
run_script run
check_exit 1
assert_contains "direct status does not report exactly 'loaded: not-loaded'; cannot safely own the controller"
assert_calls_not_contains "start-test start"
assert_calls_not_contains "dogfood disable"

# fail closed when direct status reports a non-exact loaded value
reset_state
touch "$WORK/state/loaded-bogus"
run_script run
check_exit 1
assert_contains "direct status does not report exactly 'loaded: not-loaded'; cannot safely own the controller"
assert_calls_not_contains "start-test start"

# fail closed when the direct read-only status fails
reset_state
touch "$WORK/state/status-fail"
run_script run
check_exit 1
assert_contains "start-test status failed"
assert_calls_not_contains "start-test start"

# fail closed when disabling the installed plugin fails
reset_state
touch "$WORK/state/installed"
touch "$WORK/state/enabled"
touch "$WORK/state/disable-fail"
run_script run
check_exit 1
assert_contains "could not disable the installed plugin"
assert_calls_not_contains "start-test start"

# fail closed when the plugin reports enabled but is not installed
reset_state
touch "$WORK/state/enabled"
run_script run
check_exit 1
assert_contains "refusing to disable an uninstalled plugin"
assert_calls_not_contains "start-test start"
assert_calls_not_contains "dogfood disable"

# fail closed on a non-exact installed value
reset_state
touch "$WORK/state/installed-bogus"
run_script run
check_exit 1
assert_contains "did not report an exact installed state"
assert_calls_not_contains "start-test start"

# fail closed on a non-exact enabled value
reset_state
touch "$WORK/state/enabled-bogus"
run_script run
check_exit 1
assert_contains "did not report an exact 'enabled: yes/no'"
assert_calls_not_contains "start-test start"

# lock contention: an existing file lock is refused and never deleted
reset_state
mkdir -p "$LIVE_BASE"
printf 'foreign-nonce\n' > "$LIVE_BASE/.lock"
run_script run
check_exit 1
assert_contains "another live-test run appears to hold the lock"
assert_calls_not_contains "start-test start"
assert_file "$LIVE_BASE/.lock"
if [[ "$(cat "$LIVE_BASE/.lock")" == "foreign-nonce" ]]; then
  PASS=$((PASS + 1))
else
  echo "FAIL: the foreign lock content was modified" >&2
  FAIL=$((FAIL + 1))
fi

# lock contention: an existing directory lock is refused and never deleted
reset_state
mkdir -p "$LIVE_BASE/.lock"
printf 'foreign-nonce\n' > "$LIVE_BASE/.lock/nonce"
run_script run
check_exit 1
assert_contains "another live-test run appears to hold the lock"
assert_calls_not_contains "start-test start"
assert_file "$LIVE_BASE/.lock/nonce"
if [[ "$(cat "$LIVE_BASE/.lock/nonce")" == "foreign-nonce" ]]; then
  PASS=$((PASS + 1))
else
  echo "FAIL: the foreign directory lock was modified" >&2
  FAIL=$((FAIL + 1))
fi

# quoted paths: a live root containing spaces is handled without breaking
reset_state
SPACE_ROOT="$WORK/root with space"
mkdir -p "$SPACE_ROOT"
set +e
DOGFOOD_SH="$FAKE_DOGFOOD" START_TEST_SH="$FAKE_START_TEST" \
  NPM_BIN="$FAKE_BIN/bin/npm" PGREP_BIN="$FAKE_BIN/bin/pgrep" \
  JOURNALCTL_BIN="$FAKE_BIN/bin/journalctl" JQ_BIN="$REAL_JQ" \
  LIVE_TEST_ROOT="$SPACE_ROOT" PATH="$FAKE_BIN/bin:$PATH" \
  FAKE_STATE_DIR="$WORK/state" FAKE_CALL_LOG="$WORK/calls.log" FAKE_TOOL_LOG="$WORK/tools.log" \
  "$BASH_PATH" "$SCRIPT" run >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 0
assert_contains "evidence retained at:"
assert_file "$(find "$SPACE_ROOT/plasma-auto-tiler-live" -name final-status.txt | head -1)"
assert_not_exists "$SPACE_ROOT/plasma-auto-tiler-live/.lock"

# signal cleanup: TERM during the foreground follow triggers stop and restore
if [[ -z "$REAL_TIMEOUT" ]]; then
  echo "SKIP signal-cleanup: timeout not found" >&2
else
  reset_state
  touch "$WORK/state/installed"
  touch "$WORK/state/enabled"
  touch "$WORK/state/follow-block"
  set +e
  DOGFOOD_SH="$FAKE_DOGFOOD" START_TEST_SH="$FAKE_START_TEST" \
    NPM_BIN="$FAKE_BIN/bin/npm" PGREP_BIN="$FAKE_BIN/bin/pgrep" \
    JOURNALCTL_BIN="$FAKE_BIN/bin/journalctl" JQ_BIN="$REAL_JQ" \
    LIVE_TEST_ROOT="$LIVE_ROOT" PATH="$FAKE_BIN/bin:$PATH" \
    FAKE_STATE_DIR="$WORK/state" FAKE_CALL_LOG="$WORK/calls.log" FAKE_TOOL_LOG="$WORK/tools.log" \
    "$REAL_TIMEOUT" --preserve-status -s TERM 3 "$BASH_PATH" "$SCRIPT" run >"$OUTPUT" 2>&1
  EXIT=$?
  set -e
  check_exit 143
  assert_contains "=== final: stopping the directly loaded script ==="
  assert_contains "=== final: restoring installed-plugin enable state ==="
  assert_contains "restore verified: plugin enabled again"
  assert_call_count 1 "start-test start"
  assert_call_count 1 "start-test stop"
  assert_file "$WORK/state/enabled"
fi

# concise preflight: one pass/fail line per step, per-step logs retained
reset_state
run_script run
check_exit 0
assert_contains "preflight: typecheck pass"
assert_contains "preflight: build pass"
assert_contains "preflight: tests pass"
assert_contains "preflight: static-scan pass"
assert_contains "preflight: bundle pass"
assert_file "$(find "$LIVE_BASE" -name typecheck.txt | head -1)"
assert_file "$(find "$LIVE_BASE" -name build.txt | head -1)"
assert_file "$(find "$LIVE_BASE" -name tests.txt | head -1)"
assert_file "$(find "$LIVE_BASE" -name static-scan.txt | head -1)"
assert_contains "loading controller; readiness wait may take up to 3 seconds"

# --verbose: preflight step output is streamed while logs are still retained
reset_state
run_script run --verbose
check_exit 0
assert_contains "preflight: typecheck pass"
assert_contains "preflight: build pass"
assert_file "$(find "$LIVE_BASE" -name typecheck.txt | head -1)"

# evidence manifest: critical run states are retained individually
reset_state
run_script run
check_exit 0
MANIFEST="$(find "$LIVE_BASE" -name manifest.txt | head -1)"
assert_file "$MANIFEST"
assert_file_contains "$MANIFEST" "nonce: live-"
assert_file_contains "$MANIFEST" "mode: full"
assert_file_contains "$MANIFEST" "kwin-pid: 2517"
assert_file_contains "$MANIFEST" "journal-cursor: cursor-live"
assert_file_contains "$MANIFEST" "installed-before: no"
assert_file_contains "$MANIFEST" "enabled-before: no"
assert_file_contains "$MANIFEST" "start-attempted: yes"
assert_file_contains "$MANIFEST" "start-result: ok"
assert_file_contains "$MANIFEST" "start-exit: 0"
assert_file_contains "$MANIFEST" "cleanup-stop-attempted: yes"
assert_file_contains "$MANIFEST" "cleanup-stop-rc: 0"
assert_file_contains "$MANIFEST" "cleanup-restore: not-needed"
assert_file_contains "$MANIFEST" "lock-removed: yes"

# stdout-only external redirection: critical states are retained in evidence
# files even when the terminal output is redirected away
reset_state
set +e
DOGFOOD_SH="$FAKE_DOGFOOD" START_TEST_SH="$FAKE_START_TEST" \
  NPM_BIN="$FAKE_BIN/bin/npm" PGREP_BIN="$FAKE_BIN/bin/pgrep" \
  JOURNALCTL_BIN="$FAKE_BIN/bin/journalctl" JQ_BIN="$REAL_JQ" \
  LIVE_TEST_ROOT="$LIVE_ROOT" PATH="$FAKE_BIN/bin:$PATH" \
  FAKE_STATE_DIR="$WORK/state" FAKE_CALL_LOG="$WORK/calls.log" FAKE_TOOL_LOG="$WORK/tools.log" \
  "$BASH_PATH" "$SCRIPT" run >/dev/null
EXIT=$?
set -e
check_exit 0
MANIFEST="$(find "$LIVE_BASE" -name manifest.txt | head -1)"
assert_file "$MANIFEST"
assert_file_contains "$MANIFEST" "start-result: ok"
assert_file_contains "$MANIFEST" "kwin-pid: 2517"
assert_file_contains "$MANIFEST" "lock-removed: yes"
START_TXT="$(find "$LIVE_BASE" -name start.txt | head -1)"
assert_file "$START_TXT"
assert_file_contains "$START_TXT" "started: plugin plasma-auto-tiler-kwin loaded"

# ordinary start failure: stderr is captured into start.txt, the exact exit
# status and transcript path are reported, and cleanup stops the attempted load
reset_state
touch "$WORK/state/start-fail"
run_script run
check_exit 1
assert_contains "start-test.sh start failed (exit status 1)"
assert_contains "start transcript retained at:"
assert_contains "no separate current-attempt diagnostic file from start-test.sh is discoverable or owned by this run; the bounded tail below is from the retained combined transcript:"
assert_contains "error: fake start failed"
assert_call_count 1 "start-test start"
assert_call_count 1 "start-test stop"
START_TXT="$(find "$LIVE_BASE" -name start.txt | head -1)"
assert_file "$START_TXT"
assert_file_contains "$START_TXT" "error: fake start failed"

# signal during start: TERM writes the interrupted-during-start marker, the
# outcome is reported as unknown/interrupted (never readiness failed), and
# cleanup still stops the attempted-but-unconfirmed load
if [[ -z "$REAL_TIMEOUT" ]]; then
  echo "SKIP signal-during-start: timeout not found" >&2
else
  reset_state
  touch "$WORK/state/start-block"
  set +e
  DOGFOOD_SH="$FAKE_DOGFOOD" START_TEST_SH="$FAKE_START_TEST" \
    NPM_BIN="$FAKE_BIN/bin/npm" PGREP_BIN="$FAKE_BIN/bin/pgrep" \
    JOURNALCTL_BIN="$FAKE_BIN/bin/journalctl" JQ_BIN="$REAL_JQ" \
    LIVE_TEST_ROOT="$LIVE_ROOT" PATH="$FAKE_BIN/bin:$PATH" \
    FAKE_STATE_DIR="$WORK/state" FAKE_CALL_LOG="$WORK/calls.log" FAKE_TOOL_LOG="$WORK/tools.log" \
    "$REAL_TIMEOUT" --preserve-status -s TERM 4 "$BASH_PATH" "$SCRIPT" run >"$OUTPUT" 2>&1
  EXIT=$?
  set -e
  check_exit 143
  assert_contains "interrupted-during-start:TERM"
  assert_contains "startup outcome: unknown/interrupted during start (TERM)"
  assert_contains "not a readiness verdict"
  assert_not_contains "readiness was not confirmed"
  assert_call_count 1 "start-test start"
  assert_call_count 1 "start-test stop"
  MARKER="$(find "$LIVE_BASE" -name interrupted-during-start.txt | head -1)"
  assert_file "$MARKER"
  assert_file_contains "$MARKER" "interrupted-during-start:TERM"
  assert_not_exists "$LIVE_BASE/.lock"
fi

echo "passes: $PASS failures: $FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
