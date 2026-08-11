#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/start-test.sh"
FAKE_BIN="$(mktemp -d)"
WORK="$(mktemp -d)"
OUTPUT="$(mktemp)"
PASS=0
FAIL=0
EXIT=0

cleanup() {
  rm -rf "$FAKE_BIN"
  rm -rf "$WORK"
  rm -f "$OUTPUT"
}
trap cleanup EXIT

make_fake_tools() {
  mkdir -p "$FAKE_BIN/bin"
  printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$FAKE_BIN/bin/npm"
  printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\\n" "2517 /nix/store/kwin-6.7.3/bin/kwin_wayland --wayland-fd 7 --socket wayland-0"' > "$FAKE_BIN/bin/pgrep"
  printf '%s\n' '#!/usr/bin/env bash' 'if [[ "$*" == *"--show-cursor"* ]]; then' '  cat "$FAKE_JOURNAL_CURSOR"' 'else' '  cat "$FAKE_JOURNAL_READ"' 'fi' > "$FAKE_BIN/bin/journalctl"
  cat > "$FAKE_BIN/bin/busctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state="${FAKE_STATE_DIR:?}"
case "$*" in
  *isScriptLoaded*)
    if [[ -f "$state/loaded-malformed" ]]; then
      printf '{"type":"b","data":[true,false]}\n'
    elif [[ -f "$state/loaded" ]]; then
      printf '{"type":"b","data":[%s]}\n' "$(cat "$state/loaded")"
    else
      printf '{"type":"b","data":[false]}\n'
    fi ;;
  *introspect*)
    printf '[{"type":"interface","name":"org.kde.kwin.Script"}]\n' ;;
  *unloadScript*)
    if [[ -f "$state/unload-fails" ]]; then
      printf '{"type":"b","data":[false]}\n'
    else
      printf 'false\n' > "$state/loaded"
      printf '{"type":"b","data":[true]}\n'
    fi ;;
  *loadScript*)
    if [[ -f "$state/load-malformed" ]]; then
      printf '{"type":"i","data":["not-an-int"]}\n'
    else
      printf '{"type":"i","data":[7]}\n'
    fi ;;
  *org.kde.kwin.Script\ run)
    printf 'ok\n' ;;
  *allComponents*)
    if [[ -f "$state/components" ]]; then
      cat "$state/components"
    else
      printf '{"type":"ao","data":[["/component/kwin"]]}\n'
    fi ;;
  *allShortcutInfos*)
    if [[ -f "$state/shortcuts" ]]; then
      cat "$state/shortcuts"
    else
      printf '{"type":"a(ssssssaiai)","data":[[]]}\n'
    fi ;;
  *)
    exit 1 ;;
esac
EOF
  chmod +x "$FAKE_BIN/bin/npm" "$FAKE_BIN/bin/pgrep" "$FAKE_BIN/bin/busctl" "$FAKE_BIN/bin/journalctl"
}

setup_state() {
  rm -rf "$WORK/state"
  mkdir -p "$WORK/state"
  printf '%s\n' "$1" > "$WORK/cursor"
  printf '%s' "$2" > "$WORK/journal_read"
}

run_script() {
  local cmd="$1"
  set +e
  FAKE_STATE_DIR="$WORK/state" FAKE_JOURNAL_CURSOR="$WORK/cursor" FAKE_JOURNAL_READ="$WORK/journal_read" \
    PATH="$FAKE_BIN/bin:$PATH" bash "$SCRIPT" "$cmd" >"$OUTPUT" 2>&1
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

TEST_RECORDS='{"type":"a(ssssssaiai)","data":[[["plasma-auto-tiler-focus-left","Focus window left","kwin","KWin","default","Default Context",[402653256],[]],["plasma-auto-tiler-move-up","Move window up","kwin","KWin","default","Default Context",[436207691],[]],["plasma-auto-tiler-detach","Detach window from tile","kwin","KWin","default","Default Context",[301989920],[]],["plasma-auto-tiler-apply-columns","Apply columns in focused leaf","kwin","KWin","default","Default Context",[402653233],[]],["KrohnkiteNextLayout","Krohnkite: Next Layout","kwin","KWin","default","Default Context",[268435548],[]]]]}'
READY_JOURNAL='{"MESSAGE":"plasma-auto-tiler:shortcut-registered"}
{"MESSAGE":"plasma-auto-tiler:startup-handlers-ready"}'

make_fake_tools

# start: successful readiness
setup_state '-- cursor: cursor-1' "$READY_JOURNAL"
run_script start
check_exit 0
assert_contains "controller readiness confirmed"
assert_contains "started:"

# start: disabled readiness fails closed
setup_state '-- cursor: cursor-1' '{"MESSAGE":"plasma-auto-tiler:disabled:shortcut-registration-failed"}'
run_script start
check_exit 1
assert_contains "controller disabled itself during startup"
assert_not_contains "started:"

# start: missing readiness fails closed
setup_state '-- cursor: cursor-1' '{"MESSAGE":"plasma-auto-tiler:shortcut-registered"}'
run_script start
check_exit 1
assert_contains "was not confirmed"
assert_not_contains "started:"

# start: malformed loadScript reply fails closed and cleans up
setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/load-malformed"
run_script start
check_exit 1
assert_contains "loadScript reply is not a strict"

# start: malformed isScriptLoaded reply fails closed
setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/loaded-malformed"
run_script start
check_exit 1
assert_contains "unexpected isScriptLoaded reply"

# start: refuses when already loaded
setup_state '-- cursor: cursor-1' ""
printf 'true\n' > "$WORK/state/loaded"
run_script start
check_exit 1
assert_contains "already loaded"

# status: distinguishes loaded state, readiness evidence, and stale action records
setup_state '-- cursor: cursor-1' "$READY_JOURNAL"
printf '%s' "$TEST_RECORDS" > "$WORK/state/shortcuts"
run_script status
check_exit 0
assert_contains "plugin: plasma-auto-tiler-kwin"
assert_contains "loaded: not-loaded"
assert_contains "controller running/callbacks: not proven"
assert_contains "controller readiness diagnostics (same-KWin-PID journal evidence): observed"
assert_contains "project action records (KGlobalAccel): 4"
assert_contains "plasma-auto-tiler-focus-left"
assert_contains "plasma-auto-tiler-detach"
assert_contains "active \"402653256\""
assert_not_contains "KrohnkiteNextLayout"
assert_contains "do not prove live callbacks"

# status: malformed allComponents reply fails closed (never zero matches)
setup_state '-- cursor: cursor-1' ""
printf '{"type":"ao","data":["/component/kwin"]}\n' > "$WORK/state/components"
run_script status
check_exit 1
assert_contains "unexpected allComponents reply"

# status: malformed allShortcutInfos tuple fails closed
setup_state '-- cursor: cursor-1' ""
printf '{"type":"a(ssssssaiai)","data":[[["malformed","tuple"]]]}\n' > "$WORK/state/shortcuts"
run_script status
check_exit 1
assert_contains "unexpected allShortcutInfos reply"

# status: malformed journal output fails closed
setup_state '-- cursor: cursor-1' 'not json'
printf '%s' "$TEST_RECORDS" > "$WORK/state/shortcuts"
run_script status
check_exit 1
assert_contains "could not parse KWin readiness diagnostics"

# stop: exact unload, verifies not loaded, leaves stale records reported
setup_state '-- cursor: cursor-1' ""
printf 'true\n' > "$WORK/state/loaded"
printf '%s' "$TEST_RECORDS" > "$WORK/state/shortcuts"
run_script stop
check_exit 0
assert_contains "stop: plugin 'plasma-auto-tiler-kwin' unloaded"
assert_contains "project action records still registered in KGlobalAccel: 4"
assert_contains "does not roll back"
assert_contains "do not prove live callbacks"
grep -Fq "false" "$WORK/state/loaded" || {
  echo "FAIL: unload did not clear the loaded state" >&2
  FAIL=$((FAIL + 1))
}

# stop: idempotent when not loaded
setup_state '-- cursor: cursor-1' ""
printf '%s' "$TEST_RECORDS" > "$WORK/state/shortcuts"
run_script stop
check_exit 0
assert_contains "is not loaded"

# stop: unloadScript returning false fails closed
setup_state '-- cursor: cursor-1' ""
printf 'true\n' > "$WORK/state/loaded"
touch "$WORK/state/unload-fails"
run_script stop
check_exit 1
assert_contains "unloadScript returned false"

# stop: malformed isScriptLoaded reply fails closed
setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/loaded-malformed"
run_script stop
check_exit 1
assert_contains "unexpected isScriptLoaded reply"

# strict parsing: unknown command and missing command fail
set +e
PATH="$FAKE_BIN/bin:$PATH" bash "$SCRIPT" bogus >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 1
assert_contains "unknown command"

set +e
PATH="$FAKE_BIN/bin:$PATH" bash "$SCRIPT" >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 1
assert_contains "missing command"

# strict parsing: extra arguments fail
set +e
PATH="$FAKE_BIN/bin:$PATH" bash "$SCRIPT" status extra >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 1
assert_contains "takes no arguments"

echo "passes: $PASS failures: $FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
