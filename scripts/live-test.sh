#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
KWIN_DIR="$REPO_ROOT/kwin"
BUNDLE="$KWIN_DIR/contents/code/main.js"

PLUGIN_ID="plasma-auto-tiler-kwin"

# Sub-scripts and host tools are overridable for hermetic shell tests.
DOGFOOD_SH="${DOGFOOD_SH:-$REPO_ROOT/scripts/dogfood-install.sh}"
START_TEST_SH="${START_TEST_SH:-$REPO_ROOT/scripts/start-test.sh}"
NPM_BIN="${NPM_BIN:-npm}"
PGREP_BIN="${PGREP_BIN:-pgrep}"
JOURNALCTL_BIN="${JOURNALCTL_BIN:-journalctl}"
JQ_BIN="${JQ_BIN:-jq}"

# Lock and nonce-owned evidence live under a base outside the repository
# (never under the protected test-output path). Override for tests.
LIVE_BASE="${LIVE_TEST_ROOT:-${XDG_RUNTIME_DIR:-/tmp}}/plasma-auto-tiler-live"

# Run-owned state.
NONCE=""
EVIDENCE_DIR=""
LOCK_DIR=""
ENABLED_BEFORE=""
INSTALLED_BEFORE=""
DISABLED_BY_US=0
RUNNING=0
START_ATTEMPTED=0
SIGNAL_RECEIVED=""
VERBOSE=0
START_BOUND_S=""
KWIN_PID=""
JOURNAL_CURSOR=""

usage() {
  cat <<'EOF'
usage: live-test.sh <command> [--help]

Interactive manual live-runner for the plasma-auto-tiler-kwin KWin script.

Commands:
  run           concise full preflight (typecheck, build, tests, static
                scan; one pass/fail line per step, logs retained), then
                disable the installed plugin if it is enabled, load and run
                the controller through start-test.sh (combined transcript
                retained at start.txt), and foreground-follow the
                same-KWin-PID project and kwin_scripting logs into a
                nonce-owned evidence directory until Ctrl-C/TERM
  run --quick   skip the full test suite but still typecheck, build the
                current bundle, and run the critical static scan
  run --verbose stream each preflight step's output to the terminal while
                still retaining it in evidence

  --help        show this help and exit

run mutates live KWin state and still requires explicit authorization under
docs/live-kwin-testing.md. It never mutates shortcut records, never kills or
restarts KWin, never creates desktops or windows, and never launches a
nested compositor. It stops only the direct script it loaded and restores
the installed-plugin enable state only when it changed it and verified the
restore.

SIGKILL (-9) cannot be trapped: if this process is killed that way, the
cleanup trap never runs, so the run lock, the loaded script, and any
installed-plugin disable may remain as residual. Recover manually by
unloading the script (scripts/start-test.sh stop), re-enabling the plugin
(scripts/dogfood-install.sh enable), and removing the stale lock under
$LIVE_BASE only after confirming no live run is active. Evidence under
$LIVE_BASE is never deleted automatically.
EOF
}

fail() {
  echo "error: $1" >&2
  exit 1
}

# Writes or replaces one manifest key/value atomically so the critical run
# states survive external stdout-only redirection. No personal data. Best
# effort: never aborts the run or cleanup.
manifest_write() {
  local key="$1" value="$2"
  [[ -n "${EVIDENCE_DIR:-}" ]] || return 0
  local tmp
  tmp="$(mktemp "${EVIDENCE_DIR}/manifest.XXXXXX")" || return 0
  if [[ -f "$EVIDENCE_DIR/manifest.txt" ]]; then
    grep -v "^${key}:" "$EVIDENCE_DIR/manifest.txt" >> "$tmp" 2>/dev/null || true
  fi
  printf '%s: %s\n' "$key" "$value" >> "$tmp"
  mv -f "$tmp" "$EVIDENCE_DIR/manifest.txt" || rm -f "$tmp"
}

# SIGINT/SIGTERM handler. Records the exact signal for cleanup and, when the
# interruption lands during a start attempt whose outcome is not yet known,
# writes the interrupted-during-start marker into the evidence directory.
trap_signal() {
  local sig="$1" num
  case "$sig" in
    INT) num=2 ;;
    TERM) num=15 ;;
    *) return ;;
  esac
  SIGNAL_RECEIVED="$sig"
  if [[ "$START_ATTEMPTED" -eq 1 && "$RUNNING" -eq 0 && -n "${EVIDENCE_DIR:-}" ]]; then
    printf 'interrupted-during-start:%s\n' "$sig" >> "$EVIDENCE_DIR/interrupted-during-start.txt"
    echo "interrupted-during-start:$sig" >&2
  fi
  exit $((128 + num))
}

# Derives the bounded readiness-wait upper bound from the start-test.sh
# contract (READINESS_ATTEMPTS x READINESS_DELAY); never guessed.
derive_start_bound() {
  local attempts delay
  attempts="$(sed -n 's/^READINESS_ATTEMPTS=\([0-9][0-9]*\)$/\1/p' "$START_TEST_SH" | head -1)"
  delay="$(sed -n 's/^READINESS_DELAY=\([0-9][0-9]*\(\.[0-9][0-9]*\)\?\)$/\1/p' "$START_TEST_SH" | head -1)"
  if [[ -z "$attempts" || -z "$delay" ]]; then
    return 1
  fi
  START_BOUND_S="$(awk -v a="$attempts" -v d="$delay" 'BEGIN { printf "%g", a * d }')"
  [[ -n "$START_BOUND_S" ]]
}

# Runs one preflight step, retaining its combined output in
# <evidence>/<name>.txt and printing one pass/fail line. On failure prints
# the log path and a bounded tail. In verbose mode the step output is also
# streamed to the terminal.
preflight_step() {
  local name="$1" dir="$2"
  shift 2
  local log="$EVIDENCE_DIR/$name.txt"
  local rc=0
  if [[ "$VERBOSE" -eq 1 ]]; then
    if ( cd "$dir" && "$@" ) 2>&1 | tee "$log"; then
      rc=0
    else
      rc="${PIPESTATUS[0]}"
    fi
  else
    if ( cd "$dir" && "$@" ) >"$log" 2>&1; then
      rc=0
    else
      rc=$?
    fi
  fi
  if [[ "$rc" -eq 0 ]]; then
    echo "preflight: $name pass"
  else
    echo "preflight: $name FAIL (exit $rc); log: $log" >&2
    tail -n 15 "$log" 2>/dev/null | sed 's/^/  /' >&2 || true
    return "$rc"
  fi
}

# Ordinary start failure: prints the exact exit/signal status, the retained
# transcript path, and a bounded current-attempt diagnostics tail owned by
# this run. Historical diagnostics are never presented as current.
report_start_failure() {
  local rc="$1"
  if [[ "$rc" -gt 128 ]]; then
    echo "error: start-test.sh start terminated by signal $((rc - 128)) (status $rc); not retrying" >&2
  else
    echo "error: start-test.sh start failed (exit status $rc); not retrying" >&2
  fi
  echo "start transcript retained at: $EVIDENCE_DIR/start.txt" >&2
  if [[ -f "$EVIDENCE_DIR/start.txt" ]]; then
    echo "no separate current-attempt diagnostic file from start-test.sh is discoverable or owned by this run; the bounded tail below is from the retained combined transcript:" >&2
    tail -n 25 "$EVIDENCE_DIR/start.txt" 2>/dev/null | sed 's/^/  /' >&2 || true
  else
    echo "current-attempt start diagnostics: unavailable (no start transcript retained)" >&2
  fi
}

# One run lock, keyed by a fresh nonce. The lock is a directory created
# atomically with mkdir (so two concurrent runs cannot both acquire it). Any
# existing path at the lock location - a stale file or a directory - is
# refused without deletion; the lock is removed only when its owned nonce is
# proven to match this run.
acquire_lock() {
  local parent
  parent="$(dirname -- "$LIVE_BASE")"
  if [[ ! -d "$parent" ]]; then
    fail "live-test evidence parent '$parent' does not exist"
  fi
  mkdir -p "$LIVE_BASE" || fail "could not create live-test base '$LIVE_BASE'"
  LOCK_DIR="$LIVE_BASE/.lock"
  NONCE="live-$(date +%Y%m%dT%H%M%S)-$$"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "error: another live-test run appears to hold the lock at '$LOCK_DIR'" >&2
    echo "refusing to run concurrently; the lock is never deleted automatically." >&2
    echo "inspect it and remove it only after confirming no live run is active." >&2
    exit 1
  fi
  printf '%s\n' "$NONCE" > "$LOCK_DIR/nonce" || {
    rmdir "$LOCK_DIR" 2>/dev/null || true
    fail "could not write the lock nonce"
  }
  EVIDENCE_DIR="$LIVE_BASE/$NONCE"
  mkdir -p "$EVIDENCE_DIR" || fail "could not create evidence dir '$EVIDENCE_DIR'"
}

find_kwin_pid() {
  local pid command candidate=""
  while IFS=' ' read -r pid command; do
    if [[ "$command" != *" --wayland-fd "* ]]; then
      continue
    fi
    if [[ -n "$candidate" ]]; then
      return 1
    fi
    candidate="$pid"
  done < <("$PGREP_BIN" -a kwin_wayland)
  if [[ -z "$candidate" ]]; then
    return 1
  fi
  printf '%s\n' "$candidate"
}

capture_pid_cursor() {
  KWIN_PID="$(find_kwin_pid)" || fail "could not identify one KWin process"
  local cursor_out
  cursor_out="$("$JOURNALCTL_BIN" --user --quiet --show-cursor -n 1)" || fail "could not capture the journal cursor"
  JOURNAL_CURSOR="${cursor_out##*-- cursor: }"
  if [[ -z "$JOURNAL_CURSOR" || "$JOURNAL_CURSOR" == "$cursor_out" ]]; then
    fail "journal cursor output did not contain an opaque cursor token"
  fi
}

# Critical static scan: shell syntax plus forbidden generated-bundle syntax
# (optional catch binding, optional chaining, ESM, source maps, node imports).
static_scan() {
  local script
  for script in \
    "$REPO_ROOT/scripts/start-test.sh" \
    "$REPO_ROOT/scripts/dogfood-install.sh" \
    "$REPO_ROOT/scripts/live-test.sh" \
    "$REPO_ROOT/scripts/nested-kwin-spike.sh"; do
    bash -n "$script" || return 1
  done
  if grep -nE 'catch[[:space:]]*\{|sourceMappingURL|node:' "$BUNDLE"; then
    echo "error: static scan found a forbidden bundle token" >&2
    return 1
  fi
  if grep -nE '\.flatMap\(|\.flat\(|Object\.fromEntries|\.finally\(|Promise\.(allSettled|any)\(|\.(trimStart|trimEnd|matchAll|replaceAll)\(' "$BUNDLE"; then
    echo "error: static scan found a post-ES2017 built-in in the bundle" >&2
    return 1
  fi
  if grep -nE '\?\.' "$BUNDLE"; then
    echo "error: static scan found optional chaining in the bundle" >&2
    return 1
  fi
  if grep -nE '^[[:space:]]*(import|export)[[:space:]]' "$BUNDLE"; then
    echo "error: static scan found an ESM import/export in the bundle" >&2
    return 1
  fi
  return 0
}

preflight() {
  local mode="$1"
  echo "=== preflight ($mode) ==="
  preflight_step typecheck "$KWIN_DIR" "$NPM_BIN" run typecheck || fail "npm typecheck failed"
  preflight_step build "$KWIN_DIR" "$NPM_BIN" run build || fail "npm build failed"
  if [[ "$mode" != "quick" ]]; then
    preflight_step tests "$KWIN_DIR" "$NPM_BIN" test || fail "npm test failed"
  fi
  preflight_step static-scan . static_scan || fail "critical static scan failed"
  if [[ ! -f "$BUNDLE" ]]; then
    echo "preflight: bundle FAIL; bundle missing at $BUNDLE after build" >&2
    fail "bundle not found after build: $BUNDLE"
  fi
  echo "preflight: bundle pass"
}

# Returns the exact "yes"/"no" enabled value from a dogfood status transcript.
# Fails closed on a missing, duplicated, or non-exact value.
read_enabled_value() {
  local text="$1" line value=""
  while IFS= read -r line; do
    if [[ "$line" == "enabled: "* ]]; then
      [[ -n "$value" ]] && return 1
      value="${line#enabled: }"
      if [[ "$value" != "yes" && "$value" != "no" ]]; then
        return 1
      fi
    fi
  done <<<"$text"
  [[ -n "$value" ]] || return 1
  printf '%s\n' "$value"
}

# dogfood-install.sh reports an installed package as "yes (<exact path>)" and
# an absent package as "no". Accept only those two documented forms.
read_installed_value() {
  local text="$1" line value=""
  while IFS= read -r line; do
    if [[ "$line" == "installed: "* ]]; then
      [[ -n "$value" ]] && return 1
      value="${line#installed: }"
      if [[ "$value" != "no" && ! "$value" =~ ^yes\ \(.+\)$ ]]; then
        return 1
      fi
    fi
  done <<<"$text"
  [[ -n "$value" ]] || return 1
  if [[ "$value" == "no" ]]; then
    printf '%s\n' no
  else
    printf '%s\n' yes
  fi
}

report_status() {
  local name="$1"
  shift
  "$@" 2>&1 | tee "$EVIDENCE_DIR/$name.txt" || true
}

follow_logs() {
  "$JOURNALCTL_BIN" --user --quiet --no-pager --after-cursor="$JOURNAL_CURSOR" "_PID=$KWIN_PID" -f -o json \
  | while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      printf '%s\n' "$line" >> "$EVIDENCE_DIR/kwin-follow.jsonl"
      msg="$("$JQ_BIN" -r '.MESSAGE // empty' <<<"$line" 2>/dev/null || true)"
      category="$("$JQ_BIN" -r '(.QT_CATEGORY // .SYSLOG_IDENTIFIER // "")' <<<"$line" 2>/dev/null || true)"
      if [[ "$msg" == plasma-auto-tiler:* ]]; then
        printf '%s\n' "$msg" >> "$EVIDENCE_DIR/plasma-auto-tiler.log"
        printf '%s\n' "$msg"
      elif [[ "$category" == "kwin_scripting" ]]; then
        printf '%s\n' "$line" >> "$EVIDENCE_DIR/kwin_scripting.log"
        printf '%s\n' "$line"
      fi
    done
}

cleanup() {
  local rc=$? restore_status
  local stop_attempted=0 stop_rc=0
  trap - EXIT INT TERM
  if [[ "$START_ATTEMPTED" -eq 1 ]]; then
    stop_attempted=1
    echo "=== final: stopping the directly loaded script ==="
    bash "$START_TEST_SH" stop >"${EVIDENCE_DIR:-}/final-stop.txt" 2>&1 || stop_rc=$?
  fi
  manifest_write cleanup-stop-attempted "$([[ "$stop_attempted" -eq 1 ]] && echo yes || echo no)"
  manifest_write cleanup-stop-rc "$stop_rc"
  if [[ "$DISABLED_BY_US" -eq 1 ]]; then
    echo "=== final: restoring installed-plugin enable state ==="
    bash "$DOGFOOD_SH" enable >"${EVIDENCE_DIR:-}/final-enable.txt" 2>&1 || true
    if restore_status="$(bash "$DOGFOOD_SH" status 2>/dev/null)" && [[ "$(read_enabled_value "$restore_status")" == "yes" ]]; then
      echo "restore verified: plugin enabled again"
      manifest_write cleanup-restore verified
    else
      echo "error: restore not verified: plugin still not reported enabled" >&2
      manifest_write cleanup-restore unverified
    fi
  else
    manifest_write cleanup-restore not-needed
  fi
  if [[ -n "${EVIDENCE_DIR:-}" ]]; then
    echo "=== final status/diagnostics/desktops ==="
    report_status final-status bash "$START_TEST_SH" status
    report_status final-diagnostics bash "$START_TEST_SH" diagnostics
    report_status final-desktops bash "$START_TEST_SH" desktops
    echo "evidence retained at: $EVIDENCE_DIR"
  fi
  if [[ -n "$SIGNAL_RECEIVED" && "$START_ATTEMPTED" -eq 1 && "$RUNNING" -eq 0 ]]; then
    echo "=== startup outcome: unknown/interrupted during start (${SIGNAL_RECEIVED}); not a readiness verdict ==="
  fi
  manifest_write lock-removed no
  if [[ -n "${LOCK_DIR:-}" && -d "$LOCK_DIR" && "$(cat "$LOCK_DIR/nonce" 2>/dev/null)" == "${NONCE:-}" ]]; then
    rm -f "$LOCK_DIR/nonce"
    rmdir "$LOCK_DIR" 2>/dev/null || true
    manifest_write lock-removed yes
  fi
  exit "$rc"
}

cmd_run() {
  local mode="$1"
  acquire_lock
  echo "=== live-test run $NONCE ==="
  echo "evidence: $EVIDENCE_DIR"
  manifest_write nonce "$NONCE"
  manifest_write evidence-dir "$EVIDENCE_DIR"
  manifest_write mode "$mode"

  preflight "$mode"

  # Read-only status: installed/enabled (dogfood) then direct KWin state.
  local dogfood_status direct_status
  dogfood_status="$(bash "$DOGFOOD_SH" status)" || fail "dogfood status failed"
  echo "=== installed-plugin state (read-only) ==="
  echo "$dogfood_status"
  INSTALLED_BEFORE="$(read_installed_value "$dogfood_status")" || {
    fail "dogfood status did not report an exact installed state"
  }
  ENABLED_BEFORE="$(read_enabled_value "$dogfood_status")" || {
    fail "dogfood status did not report an exact 'enabled: yes/no'"
  }
  manifest_write installed-before "$INSTALLED_BEFORE"
  manifest_write enabled-before "$ENABLED_BEFORE"

  direct_status="$(bash "$START_TEST_SH" status)" || fail "start-test status failed"
  echo "=== direct controller status (read-only) ==="
  echo "$direct_status"
  if ! grep -qFx 'loaded: not-loaded' <<<"$direct_status"; then
    fail "direct status does not report exactly 'loaded: not-loaded'; cannot safely own the controller"
  fi

  # Disable only the exact installed plugin if it is enabled, so KWin does not
  # auto-load it while start-test.sh loads it directly. Fail closed if the
  # plugin reports enabled but is not actually installed.
  if [[ "$ENABLED_BEFORE" == "yes" ]]; then
    if [[ "$INSTALLED_BEFORE" != "yes" ]]; then
      fail "installed plugin reports enabled=yes but installed=no; refusing to disable an uninstalled plugin"
    fi
    bash "$DOGFOOD_SH" disable || fail "could not disable the installed plugin"
    DISABLED_BY_US=1
    manifest_write disabled-by-us yes
    echo "disabled installed plugin (was enabled); will restore on exit"
  fi

  capture_pid_cursor
  echo "kwin pid: $KWIN_PID"
  manifest_write kwin-pid "$KWIN_PID"
  manifest_write journal-cursor "$JOURNAL_CURSOR"

  if ! derive_start_bound; then
    fail "could not derive the readiness-wait bound from the $START_TEST_SH contract (READINESS_ATTEMPTS/READINESS_DELAY)"
  fi
  echo "loading controller; readiness wait may take up to $START_BOUND_S seconds"
  START_ATTEMPTED=1
  manifest_write start-attempted yes
  local start_rc=0
  if bash "$START_TEST_SH" start 2>&1 | tee "$EVIDENCE_DIR/start.txt"; then
    RUNNING=1
    manifest_write start-result ok
    manifest_write start-exit 0
  else
    start_rc=${PIPESTATUS[0]}
    manifest_write start-result failed
    manifest_write start-exit "$start_rc"
    report_start_failure "$start_rc"
    exit 1
  fi

  echo "=== controller status/diagnostics/desktops ==="
  report_status status bash "$START_TEST_SH" status
  report_status diagnostics bash "$START_TEST_SH" diagnostics
  report_status desktops bash "$START_TEST_SH" desktops

  echo "=== checklist ==="
  echo "- controller loaded and running (see status above; callbacks proven only by an exact -invoked/-rejected/-failed diagnostic token)"
  echo "- readiness confirmed: shortcut-registered then startup-handlers-ready, no disabled: diagnostic"
  echo "- no same-KWin-PID kwin_scripting evaluation error observed"
  echo "- evidence directory: $EVIDENCE_DIR"
  echo "=== following live same-KWin-PID project and kwin_scripting logs (Ctrl-C to stop) ==="
  follow_logs || true
  echo "=== live-test run $NONCE ended ==="
}

if [[ $# -eq 0 ]]; then
  echo "error: missing command (run)" >&2
  usage >&2
  exit 1
fi

case "${1:-}" in
  --help|-h)
    if [[ $# -ne 1 ]]; then
      echo "error: '--help' takes no arguments" >&2
      exit 1
    fi
    usage
    exit 0
    ;;
  run)
    if [[ $# -gt 3 ]]; then
      echo "error: 'run' takes at most two arguments (--quick, --verbose)" >&2
      exit 1
    fi
    RUN_QUICK=0
    VERBOSE=0
    for RUN_ARG in "${@:2}"; do
      case "$RUN_ARG" in
        --quick) RUN_QUICK=1 ;;
        --verbose) VERBOSE=1 ;;
        *)
          echo "error: unknown run argument '$RUN_ARG' (expected --quick and/or --verbose)" >&2
          exit 1
          ;;
      esac
    done
    mode="full"
    if [[ "$RUN_QUICK" -eq 1 ]]; then
      mode="quick"
    fi
    trap cleanup EXIT
    trap 'trap_signal INT' INT
    trap 'trap_signal TERM' TERM
    cmd_run "$mode"
    ;;
  *)
    echo "error: unknown command '$1'" >&2
    usage >&2
    exit 1
    ;;
esac
