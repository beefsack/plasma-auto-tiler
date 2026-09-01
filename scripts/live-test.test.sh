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
REAL_STAT="$(command -v stat)"
BASH_PATH="$(command -v bash)"
FAKE_PROVENANCE_BUILD="checkout-carrier-v1-$(sha256sum "$REPO_ROOT/kwin/src/provenance-entry.ts" | awk '{print $1}')"

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
set -euo pipefail
count=0
[[ -f "${FAKE_STATE_DIR:?}/pgrep-count" ]] && count="$(cat "$FAKE_STATE_DIR/pgrep-count")"
count=$((count + 1))
printf '%s\n' "$count" > "$FAKE_STATE_DIR/pgrep-count"
printf '9999 /tmp/lookalike --wayland-fd 7 --socket wayland-0\n8888 /nix/store/other/bin/kwin_wayland --wayland-fd 8 --socket wayland-1\n'
EOF


  cat > "$FAKE_BIN/bin/stat" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
real_stat="${REAL_STAT_BIN:-}"
if [[ -z "$real_stat" ]]; then
  real_stat="$(PATH="${PATH#*:}" command -v stat)"
fi
exec "$real_stat" "$@"
EOF

  cat > "$FAKE_BIN/bin/busctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state="${FAKE_STATE_DIR:?}"
case "$*" in
  *"GetNameOwner s org.kde.KWin"*)
    count=0
    [[ -f "$state/kwin-owner-count" ]] && count="$(cat "$state/kwin-owner-count")"
    count=$((count + 1))
    printf '%s\n' "$count" > "$state/kwin-owner-count"
    printf '{"type":"s","data":[":1.10"]}\n' ;;
  *"GetConnectionUnixProcessID s :1.10"*)
    count=0
    [[ -f "$state/kwin-owner-count" ]] && count="$(cat "$state/kwin-owner-count")"
    pid=2517
    if [[ -f "$state/identity-capture-fail" ]]; then pid=999999999; fi
    if [[ -f "$state/kwin-restart" && "$count" -gt 1 ]]; then pid=9999; fi
    start=251700
    if [[ -n "${FAKE_KWIN_IDENTITY_SEQUENCE:-}" ]]; then
      IFS=',' read -r -a identities <<<"$FAKE_KWIN_IDENTITY_SEQUENCE"
      index=$((count - 1))
      [[ "$index" -lt "${#identities[@]}" ]] && start="${identities[$index]}" || start="${identities[$((${#identities[@]} - 1))]}"
    fi
    if [[ ! -f "$state/identity-capture-fail" ]]; then
      mkdir -p "${FAKE_PROC_ROOT:?}/$pid"
      fields=S
      for ((index = 1; index < 19; index += 1)); do fields+=' 0'; done
      fields+=" $start"
      printf '%s (kwin_wayland) %s\n' "$pid" "$fields" > "${FAKE_PROC_ROOT:?}/$pid/stat"
    fi
    printf '{"type":"u","data":[%s]}\n' "$pid" ;;
  *) exit 1 ;;
esac
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
    elif [[ -f "$state/installed-path-bogus" ]]; then
      printf 'installed: yes (/tmp/../escape)\n'
    else
      installed="no"
       [[ -f "$state/installed" ]] && installed="yes (${FAKE_PACKAGE_PATH:?})"
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
    [[ "${RESTORE_LOADED:-}" == loaded ]] && touch "$state/loaded"
    printf 'enabled: plasma-auto-tiler-kwinEnabled set to true and KWin reconfigured\n'
    ;;
  disable)
    if [[ -f "$state/disable-fail" ]]; then
      echo "error: fake disable failed" >&2
      exit 1
    fi
    rm -f "$state/enabled"
    # Disabling the enabled plugin normally unloads the auto-loaded controller,
    # unless a residual loaded state is simulated (KWin failed to unload it) or
    # a delayed unload is simulated (KWin unloads it shortly after).
    if [[ ! -f "$state/residual-loaded" && ! -f "$state/delayed-unload" ]]; then
      rm -f "$state/loaded"
    fi
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
    elif [[ -f "$state/delayed-unload" && -f "$state/loaded" ]]; then
      n=0
      [[ -f "$state/status-count" ]] && n="$(cat "$state/status-count")"
      n=$((n + 1))
      printf '%s\n' "$n" > "$state/status-count"
      if [[ "$n" -le 2 ]]; then
        printf 'loaded: loaded\n'
      else
        rm -f "$state/loaded"
        printf 'loaded: not-loaded\n'
      fi
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
    printf 'started: plugin plasma-auto-tiler-kwin loaded; controller readiness confirmed; script-id=7\n'
    ;;
  provenance)
    plugin="${PROVENANCE_PLUGIN_ID:-plasma-auto-tiler-checkout-provenance-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}"
    if [[ -f "$state/carrier-loaded" ]]; then
      printf 'provenance-baseline: plugin=%s loaded=loaded\n' "$plugin"
      exit 1
    fi
    if [[ -f "$state/package-extra" ]]; then
      printf 'extra\n' > "$FAKE_PACKAGE_PATH/unexpected.txt"
    fi
    if [[ -f "$state/package-symlink" ]]; then
      ln -s contents/code/main.js "$FAKE_PACKAGE_PATH/unexpected-link"
    fi
    if [[ -f "$state/package-dir-mtime-drift" ]]; then
      touch "$FAKE_PACKAGE_PATH/contents"
    fi
    if [[ -f "$state/config-mtime-drift" ]]; then
      touch "$XDG_CONFIG_HOME/kwinrc"
    fi
    if [[ -f "$state/config-content-drift" ]]; then
      printf 'drifted\n' > "$XDG_CONFIG_HOME/kwinrc"
    fi
    printf 'provenance-baseline: plugin=%s loaded=not-loaded\n' "$plugin"
    touch "$state/carrier-loaded"
    receipt="{\"kind\":\"provenance\",\"nonce\":\"${2:?}\",\"build\":\"${FAKE_PROVENANCE_BUILD:?}\",\"plugin\":\"$plugin\",\"script_id\":19,\"pid\":2517,\"start_identity\":\"251700\"}"
    if [[ -f "$state/provenance-partial" ]]; then
      printf 'provenance: partial nonce=%s build=%s pid=2517 script-id=19 plugin=%s cleanup=unverified\n' "${2:?}" "${FAKE_PROVENANCE_BUILD:?}" "$plugin"
      exit 1
    elif [[ -f "$state/provenance-partial-receipt" ]]; then
      printf 'provenance: partial nonce=%s build=%s pid=2517 script-id=19 plugin=%s cleanup=verified loaded-after=not-loaded receipt=%s\n' "${2:?}" "${FAKE_PROVENANCE_BUILD:?}" "$plugin" "$receipt"
      exit 1
    elif [[ -f "$state/provenance-partial-unverified-claim" ]]; then
      printf 'provenance: partial nonce=%s build=%s pid=2517 script-id=19 plugin=%s cleanup=verified loaded-after=loaded\n' "${2:?}" "${FAKE_PROVENANCE_BUILD:?}" "$plugin"
      exit 1
    fi
    if [[ -f "$state/provenance-malformed-receipt" ]]; then
      receipt='not-json'
    elif [[ -f "$state/provenance-receipt-mismatch" ]]; then
      receipt="{\"kind\":\"provenance\",\"nonce\":\"${2:?}\",\"build\":\"${FAKE_PROVENANCE_BUILD:?}\",\"plugin\":\"$plugin\",\"script_id\":18,\"pid\":2517,\"start_identity\":\"251700\"}"
    fi
    printf 'provenance: ready nonce=%s build=%s pid=2517 script-id=19 plugin=%s receipt=%s\n' "${2:?}" "${FAKE_PROVENANCE_BUILD:?}" "$plugin" "$receipt"
    ;;
  provenance-stop)
    plugin="${PROVENANCE_PLUGIN_ID:-plasma-auto-tiler-checkout-provenance-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}"
    if [[ -f "$state/replace-lock-on-stop" ]]; then
      lock="${LIVE_TEST_ROOT:?}/plasma-auto-tiler-live/.lock/plugin-id"
      rm -f -- "$lock"
      ln -s -- "${FAKE_REPLACEMENT_TARGET:?}" "$lock"
    fi
    if [[ -f "$state/carrier-stuck" ]]; then
      printf 'provenance-stop: script-id=%s plugin=%s unloaded and verified loaded-after=loaded\n' "${2:?}" "$plugin"
    else
      rm -f "$state/carrier-loaded"
      printf 'provenance-stop: script-id=%s plugin=%s unloaded and verified loaded-after=not-loaded\n' "${2:?}" "$plugin"
    fi
    ;;
  snapshot-shortcuts)
    snapshot_count=0
    [[ -f "$state/snapshot-count" ]] && snapshot_count="$(cat "$state/snapshot-count")"
    snapshot_count=$((snapshot_count + 1))
    printf '%s\n' "$snapshot_count" > "$state/snapshot-count"
    if [[ -f "$state/shortcut-drift" && "$snapshot_count" -gt 1 ]]; then
      printf '[["plasma-auto-tiler-insert-right","Insert","other","Other","default","Default",[1],[]]]\n'
    else
      printf '[]\n'
    fi
    ;;
  snapshot-kglobalaccel)
    if [[ -f "$state/kglobalaccel-drift" && -f "$state/kglobalaccel-seen" ]]; then
      printf '{"service":"org.kde.kglobalaccel","owner":":9.99","pid":9999,"uid":1000}\n'
    else
      touch "$state/kglobalaccel-seen"
      printf '{"service":"org.kde.kglobalaccel","owner":":1.10","pid":1001,"uid":1000}\n'
    fi
    ;;
  stop)
    rm -f "$state/loaded"
    rm -f "$state/delayed-unload"
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

  chmod +x "$FAKE_BIN/bin/npm" "$FAKE_BIN/bin/pgrep" "$FAKE_BIN/bin/stat" "$FAKE_BIN/bin/busctl" "$FAKE_BIN/bin/journalctl" "$FAKE_DOGFOOD" "$FAKE_START_TEST"
}

reset_state() {
  rm -rf "$WORK/state" "$LIVE_ROOT"
  mkdir -p "$WORK/state" "$LIVE_ROOT"
  : > "$WORK/calls.log"
  : > "$WORK/tools.log"
}

run_script() {
  set +e
  if [[ -f "$WORK/state/installed" && ! -f "$WORK/state/package-fixture" ]]; then
    mkdir -p "$WORK/state/package/contents/code" "$WORK/state/package/contents/config" "$WORK/state/package/contents/ui"
    printf 'metadata\n' > "$WORK/state/package/metadata.json"
    printf 'bundle\n' > "$WORK/state/package/contents/code/main.js"
    printf 'config\n' > "$WORK/state/package/contents/config/main.xml"
    printf 'ui\n' > "$WORK/state/package/contents/ui/config.ui"
  fi
  if [[ -f "$WORK/state/live-base-symlink" ]]; then
    mkdir -p "$WORK/other-root"
    rm -rf "$LIVE_BASE"
    ln -s "$WORK/other-root" "$LIVE_BASE"
  fi
  DOGFOOD_SH="$FAKE_DOGFOOD" START_TEST_SH="$FAKE_START_TEST" \
    NPM_BIN="$FAKE_BIN/bin/npm" BUSCTL_BIN="$FAKE_BIN/bin/busctl" PGREP_BIN="$FAKE_BIN/bin/pgrep" STAT_BIN="$FAKE_BIN/bin/stat" \
    JOURNALCTL_BIN="$FAKE_BIN/bin/journalctl" JQ_BIN="$REAL_JQ" \
    LIVE_TEST_ROOT="$LIVE_ROOT" HOME="$WORK/home" XDG_CONFIG_HOME="$WORK/config" PROC_ROOT="$WORK/proc" FAKE_PROC_ROOT="$WORK/proc" PLASMA_AUTO_TILER_HERMETIC_TEST=1 FAKE_PROVENANCE_BUILD="$FAKE_PROVENANCE_BUILD" FAKE_PACKAGE_PATH="$WORK/state/package" PATH="$FAKE_BIN/bin:$PATH" \
    FAKE_STATE_DIR="$WORK/state" FAKE_CALL_LOG="$WORK/calls.log" FAKE_TOOL_LOG="$WORK/tools.log" FAKE_REPLACEMENT_TARGET="$WORK/replacement-target" FAKE_KWIN_IDENTITY_SEQUENCE="${FAKE_KWIN_IDENTITY_SEQUENCE:-}" \
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

# success (full preflight): runs only the provenance carrier setup/restore
# phase, proves exact baseline restoration, and retains evidence
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
assert_contains "=== pre-carrier controller load-state status (read-only) ==="
assert_contains "loaded: not-loaded"
assert_contains "kwin pid: 2517"
# The process-name fixture is deliberately wrong and ambiguous. The live
# runner must use the D-Bus owner PID and never consult it.
if [[ ! -e "$WORK/state/pgrep-count" ]]; then
  PASS=$((PASS + 1))
else
  echo "FAIL: live-test consulted the misleading pgrep fixture" >&2
  FAIL=$((FAIL + 1))
fi
assert_contains "=== checklist ==="
assert_contains "future Custom Tile journey: explicitly gated and not attempted"
assert_contains "=== live-test provenance setup complete; restore phase follows ==="
assert_contains "=== live-test run live-" # prefix of the run nonce
assert_contains "=== final: stopping the exact checkout provenance carrier ==="
assert_contains "exact project baseline restoration verified"
assert_contains "evidence retained at:"
assert_calls_contains "start-test provenance"
assert_calls_contains "start-test provenance-stop"
assert_calls_contains "start-test snapshot-shortcuts"
assert_calls_not_contains "start-test start"
assert_calls_not_contains "start-test stop"
assert_calls_not_contains "dogfood disable"
assert_calls_not_contains "dogfood enable"
assert_not_exists "$LIVE_BASE/.lock"
assert_file "$(find "$LIVE_BASE" -name final-provenance-stop.txt | head -1)"
PROVENANCE_TXT="$(find "$LIVE_BASE" -name provenance.txt | head -1)"
assert_file "$PROVENANCE_TXT"
assert_file_contains "$PROVENANCE_TXT" 'receipt={"kind":"provenance"'

# lock cleanup refuses a plugin-id path replaced by a symlink during carrier
# teardown and leaves the outside target untouched.
reset_state
printf 'outside-lock-sentinel\n' > "$WORK/replacement-target"
touch "$WORK/state/replace-lock-on-stop"
run_script run --quick
check_exit 1
assert_contains "refusing lock cleanup because the owned lock path changed or is unsafe"
assert_file_contains "$WORK/replacement-target" "outside-lock-sentinel"
[[ -L "$LIVE_BASE/.lock/plugin-id" ]] || { echo "FAIL: replaced lock path was not retained for safe recovery" >&2; FAIL=$((FAIL + 1)); }

# A KWin identity change after all baseline reads but before the success claim
# still invalidates restoration.
reset_state
FAKE_KWIN_IDENTITY_SEQUENCE='251700,251700,251700,251700,251700,251701' run_script run --quick
check_exit 1
assert_contains "KWin PID/start identity changed after baseline verification"
MANIFEST="$(find "$LIVE_BASE" -name manifest.txt | head -1)"
assert_file_contains "$MANIFEST" "baseline-restore: unverified"

# baseline: config mtime is part of exact byte/state equality, so mtime drift
# and content drift both fail restoration.
reset_state
mkdir -p "$WORK/config"
printf '[Plugins]\nplasma-auto-tiler-kwinEnabled=false\n' > "$WORK/config/kwinrc"
touch "$WORK/state/config-mtime-drift"
run_script run --quick
check_exit 1
assert_contains "baseline verification failed: KWin config"

reset_state
printf '[Plugins]\nplasma-auto-tiler-kwinEnabled=false\n' > "$WORK/config/kwinrc"
touch "$WORK/state/config-content-drift"
run_script run --quick
check_exit 1
assert_contains "baseline verification failed: KWin config"

# baseline: extra regular entries and symlinks added after capture invalidate
# exact package-tree restoration.
reset_state
touch "$WORK/state/installed"
touch "$WORK/state/package-extra"
run_script run --quick
check_exit 1
assert_contains "baseline verification failed: installed package"

reset_state
touch "$WORK/state/installed"
touch "$WORK/state/package-symlink"
run_script run --quick
check_exit 1
assert_contains "baseline verification failed: installed package"

reset_state
touch "$WORK/state/installed"
touch "$WORK/state/package-dir-mtime-drift"
run_script run --quick
check_exit 1
assert_contains "baseline verification failed: installed package"

# baseline: a KGlobalAccel owner replacement invalidates cleanup even when all
# shortcut tuples are unchanged.
reset_state
touch "$WORK/state/kglobalaccel-drift"
run_script run --quick
check_exit 1
assert_contains "baseline verification failed: KGlobalAccel service owner identity"

# evidence: an attacker-controlled symlink at the generated evidence root is
# rejected before lock or lifecycle creation.
reset_state
touch "$WORK/state/live-base-symlink"
run_script run --quick
check_exit 1
assert_contains "live-test evidence base is a symlink"
assert_calls_not_contains "start-test provenance"

# provenance: a failed setup returns its exact ownership state, allowing the
# runner to issue the exact cleanup command and retain the failed outcome.
reset_state
touch "$WORK/state/provenance-partial"
run_script run --quick
check_exit 1
assert_calls_contains "start-test provenance-stop"
MANIFEST="$(find "$LIVE_BASE" -name manifest.txt | head -1)"
assert_file_contains "$MANIFEST" "provenance-script-id: 19"
assert_file_contains "$MANIFEST" "operational-binding: not-proven"

# provenance: an inline receipt on a partial result is malformed even when the
# receipt itself is exact; the parsed carrier is still stopped safely.
reset_state
touch "$WORK/state/provenance-partial-receipt"
run_script run --quick
check_exit 1
assert_contains "checkout provenance receipt was malformed, extra, or mismatched"
assert_calls_contains "start-test provenance-stop"
assert_not_exists "$WORK/state/carrier-loaded"
PROVENANCE_TXT="$(find "$LIVE_BASE" -name provenance.txt | head -1)"
assert_file_contains "$PROVENANCE_TXT" "provenance: partial nonce="
assert_file_contains "$PROVENANCE_TXT" " receipt={\"kind\":\"provenance\""

# provenance: cleanup=verified is not trusted without the strict unloaded
# postcondition; the exact parsed carrier is stopped instead.
reset_state
touch "$WORK/state/provenance-partial-unverified-claim"
run_script run --quick
check_exit 1
assert_contains "checkout provenance partial cleanup result was not strictly verified"
assert_calls_contains "start-test provenance-stop"
assert_not_exists "$WORK/state/carrier-loaded"

# provenance: the exact inline receipt is accepted, while malformed and
# mismatched receipts still tear down the parsed exact carrier ownership.
reset_state
touch "$WORK/state/provenance-malformed-receipt"
run_script run --quick
check_exit 1
assert_contains "checkout provenance receipt was malformed, extra, or mismatched"
assert_calls_contains "start-test provenance-stop"
assert_not_exists "$WORK/state/carrier-loaded"
MANIFEST="$(find "$LIVE_BASE" -name manifest.txt | head -1)"
assert_file_contains "$MANIFEST" "cleanup-provenance: verified"

reset_state
touch "$WORK/state/provenance-receipt-mismatch"
run_script run --quick
check_exit 1
assert_contains "checkout provenance receipt was malformed, extra, or mismatched"
assert_calls_contains "start-test provenance-stop"
assert_not_exists "$WORK/state/carrier-loaded"

# carrier baseline: a pre-existing unique carrier is rejected before the live
# runner attempts to establish ownership.
reset_state
touch "$WORK/state/carrier-loaded"
run_script run --quick
check_exit 1
assert_contains "checkout provenance setup was not tied to the captured KWin identity"
assert_calls_not_contains "start-test provenance-stop"
MANIFEST="$(find "$LIVE_BASE" -name manifest.txt | head -1)"
assert_file_contains "$MANIFEST" "cleanup-provenance: unverified"

# carrier final verification: cleanup output that does not prove the unique
# carrier is unloaded fails the run even when controller restoration matches.
reset_state
touch "$WORK/state/carrier-stuck"
run_script run --quick
check_exit 1
assert_contains "provenance carrier was not proven unloaded"
MANIFEST="$(find "$LIVE_BASE" -name manifest.txt | head -1)"
assert_file_contains "$MANIFEST" "cleanup-provenance: unverified"

# baseline: an installed package symlink is rejected before any lifecycle load.
reset_state
touch "$WORK/state/installed"
mkdir -p "$WORK/state/real-package"
ln -s real-package "$WORK/state/package"
run_script run --quick
check_exit 1
assert_contains "installed package path is missing, unsafe, or symlinked"
assert_calls_not_contains "start-test provenance"

# baseline: a traversal-shaped installed path is rejected without cleanup.
reset_state
touch "$WORK/state/installed-path-bogus"
run_script run --quick
check_exit 1
assert_contains "installed package path is missing, unsafe, or symlinked"
assert_calls_not_contains "start-test start"

# baseline: exact shortcut tuple drift after capture makes cleanup unverified.
reset_state
touch "$WORK/state/shortcut-drift"
run_script run --quick
check_exit 1
assert_contains "exact baseline restoration was not verified"
assert_contains "baseline verification failed: project shortcuts"

# lifecycle: a KWin PID/start identity change prevents stale controller/carrier
# handles from being used and cannot produce a successful run.
reset_state
touch "$WORK/state/kwin-restart"
run_script run --quick
check_exit 1
assert_contains "KWin PID/start identity changed during baseline capture"
assert_calls_not_contains "start-test start"

# lifecycle: a same-PID start identity replacement after setup begins keeps the
# baseline immutable, so cleanup reports restoration unverified without tearing
# down the carrier or re-enabling the plugin against the replacement process.
reset_state
touch "$WORK/state/installed"
touch "$WORK/state/enabled"
FAKE_KWIN_IDENTITY_SEQUENCE='251700,251700,251701' run_script run --quick
check_exit 1
assert_contains "KWin PID/start identity changed during provenance setup"
assert_contains "KWin PID/start identity changed; refusing stale-handle cleanup"
assert_calls_not_contains "start-test provenance-stop"
assert_call_count 0 "dogfood disable"
assert_call_count 0 "dogfood enable"
MANIFEST="$(find "$LIVE_BASE" -name manifest.txt | head -1)"
assert_file_contains "$MANIFEST" "cleanup-provenance: unverified"
assert_file_contains "$MANIFEST" "cleanup-restore: not-needed"
assert_file_contains "$MANIFEST" "baseline-restore: unverified"

# pre-effect identity capture failure reports the blocker cleanly and removes
# only this run's lock without attempting lifecycle or broad cleanup.
reset_state
touch "$WORK/state/identity-capture-fail"
run_script run --quick
check_exit 1
assert_contains "could not capture KWin PID/start identity"
assert_contains "KWin identity unavailable; refusing stale-handle cleanup"
assert_calls_not_contains "start-test provenance"
assert_calls_not_contains "start-test start"
assert_not_exists "$LIVE_BASE/.lock"

# quick: skips the full test suite but still typechecks, builds, and static-scans
reset_state
run_script run --quick
check_exit 0
assert_contains "=== preflight (quick) ==="
assert_tools_contains "npm run typecheck"
assert_tools_contains "npm run build"
assert_tools_not_contains "npm test"
assert_contains "=== checklist ==="
assert_call_count 0 "start-test start"

# installed and enabled: observe and preserve the controller plugin state
reset_state
touch "$WORK/state/installed"
touch "$WORK/state/enabled"
run_script run
check_exit 0
assert_not_contains "restoring installed-plugin enable state"
assert_calls_not_contains "dogfood disable"
assert_calls_not_contains "dogfood enable"
assert_file "$WORK/state/enabled"
assert_not_exists "$LIVE_BASE/.lock"

# an enable failure fixture is irrelevant because carrier-only setup never
# enables or reconfigures the installed controller.
reset_state
touch "$WORK/state/installed"
touch "$WORK/state/enabled"
touch "$WORK/state/enable-fail"
run_script run --quick
check_exit 0
assert_contains "exact project baseline restoration verified"
assert_calls_not_contains "dogfood enable"

# initially disabled: never enables, never disables
reset_state
run_script run
check_exit 0
assert_calls_not_contains "dogfood disable"
assert_calls_not_contains "dogfood enable"
assert_not_exists "$WORK/state/enabled"

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

# an already-loaded controller remains untouched while the unique carrier runs
reset_state
touch "$WORK/state/loaded"
run_script run
check_exit 0
assert_contains "exact project baseline restoration verified"
assert_calls_contains "start-test provenance"
assert_calls_not_contains "start-test start"
assert_calls_not_contains "dogfood disable"

# fail closed when direct status reports a non-exact loaded value
reset_state
touch "$WORK/state/loaded-bogus"
run_script run
check_exit 1
assert_contains "direct status does not report an exact controller loaded state"
assert_calls_not_contains "start-test start"
MANIFEST="$(find "$LIVE_BASE" -name manifest.txt | head -1)"
if [[ -f "$MANIFEST" ]] && grep -qF "baseline-restore: unverified" "$MANIFEST"; then
  PASS=$((PASS + 1))
else
  echo "FAIL: malformed status scenario must record an unverified baseline" >&2
  cat "$MANIFEST" >&2
  FAIL=$((FAIL + 1))
fi

# fail closed when the direct read-only status fails
reset_state
touch "$WORK/state/status-fail"
run_script run
check_exit 1
assert_contains "start-test status failed during baseline capture"
assert_calls_not_contains "start-test start"
MANIFEST="$(find "$LIVE_BASE" -name manifest.txt | head -1)"
if [[ -f "$MANIFEST" ]] && grep -qF "baseline-restore: unverified" "$MANIFEST"; then
  PASS=$((PASS + 1))
else
  echo "FAIL: status-failure scenario must record an unverified baseline" >&2
  cat "$MANIFEST" >&2
  FAIL=$((FAIL + 1))
fi

# a disable failure fixture cannot affect carrier-only setup
reset_state
touch "$WORK/state/installed"
touch "$WORK/state/enabled"
touch "$WORK/state/disable-fail"
run_script run
check_exit 0
assert_contains "exact project baseline restoration verified"
assert_calls_not_contains "start-test start"
assert_calls_not_contains "dogfood disable"

# enabled state is observational even when installation state is absent
reset_state
touch "$WORK/state/enabled"
run_script run
check_exit 0
assert_contains "exact project baseline restoration verified"
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
  NPM_BIN="$FAKE_BIN/bin/npm" BUSCTL_BIN="$FAKE_BIN/bin/busctl" PGREP_BIN="$FAKE_BIN/bin/pgrep" \
  JOURNALCTL_BIN="$FAKE_BIN/bin/journalctl" JQ_BIN="$REAL_JQ" \
  LIVE_TEST_ROOT="$SPACE_ROOT" HOME="$WORK/home" XDG_CONFIG_HOME="$WORK/config" PROC_ROOT="$WORK/proc" FAKE_PROC_ROOT="$WORK/proc" PLASMA_AUTO_TILER_HERMETIC_TEST=1 FAKE_PROVENANCE_BUILD="$FAKE_PROVENANCE_BUILD" FAKE_PACKAGE_PATH="$WORK/state/package" PATH="$FAKE_BIN/bin:$PATH" \
  FAKE_STATE_DIR="$WORK/state" FAKE_CALL_LOG="$WORK/calls.log" FAKE_TOOL_LOG="$WORK/tools.log" \
  "$BASH_PATH" "$SCRIPT" run >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 0
assert_contains "evidence retained at:"
assert_file "$(find "$SPACE_ROOT/plasma-auto-tiler-live" -name final-status.txt | head -1)"
assert_not_exists "$SPACE_ROOT/plasma-auto-tiler-live/.lock"

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
assert_contains "future Custom Tile journey: explicitly gated and not attempted"

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
assert_file_contains "$MANIFEST" "loaded-before: not-loaded"
assert_file_contains "$MANIFEST" "provenance-loaded-before: not-loaded"
assert_file_contains "$MANIFEST" "operational-binding: proven"
assert_file_contains "$MANIFEST" "provenance-plugin-id: plasma-auto-tiler-checkout-provenance-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
assert_file_contains "$MANIFEST" "cleanup-provenance: verified"
assert_file_contains "$MANIFEST" "provenance-loaded-after: not-loaded"
assert_file_contains "$MANIFEST" "baseline-restore: verified"
assert_file_contains "$MANIFEST" "future-journey: gated-not-attempted"
assert_file_contains "$MANIFEST" "cleanup-restore: not-needed"
assert_file_contains "$MANIFEST" "lock-removed: yes"

# stdout-only external redirection: critical states are retained in evidence
# files even when the terminal output is redirected away
reset_state
set +e
  DOGFOOD_SH="$FAKE_DOGFOOD" START_TEST_SH="$FAKE_START_TEST" \
  NPM_BIN="$FAKE_BIN/bin/npm" BUSCTL_BIN="$FAKE_BIN/bin/busctl" PGREP_BIN="$FAKE_BIN/bin/pgrep" \
  JOURNALCTL_BIN="$FAKE_BIN/bin/journalctl" JQ_BIN="$REAL_JQ" \
  LIVE_TEST_ROOT="$LIVE_ROOT" HOME="$WORK/home" XDG_CONFIG_HOME="$WORK/config" PROC_ROOT="$WORK/proc" FAKE_PROC_ROOT="$WORK/proc" PLASMA_AUTO_TILER_HERMETIC_TEST=1 FAKE_PROVENANCE_BUILD="$FAKE_PROVENANCE_BUILD" FAKE_PACKAGE_PATH="$WORK/state/package" PATH="$FAKE_BIN/bin:$PATH" \
  FAKE_STATE_DIR="$WORK/state" FAKE_CALL_LOG="$WORK/calls.log" FAKE_TOOL_LOG="$WORK/tools.log" \
  "$BASH_PATH" "$SCRIPT" run >/dev/null
EXIT=$?
set -e
check_exit 0
MANIFEST="$(find "$LIVE_BASE" -name manifest.txt | head -1)"
assert_file "$MANIFEST"
assert_file_contains "$MANIFEST" "cleanup-provenance: verified"
assert_file_contains "$MANIFEST" "provenance-loaded-after: not-loaded"
assert_file_contains "$MANIFEST" "kwin-pid: 2517"
assert_file_contains "$MANIFEST" "lock-removed: yes"

echo "passes: $PASS failures: $FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
