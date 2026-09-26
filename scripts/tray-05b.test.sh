#!/usr/bin/env bash
set -euo pipefail

# AR13 hermetic tray single-instance/delivery check on a private bus.
# Exercises the one `tray` command only: first instance acquires
# org.plasmaautotiler.Tray, a second exits 0 (DoNotQueue taken), the first
# keeps serving, watcher loss and missing watcher stay alive unregistered
# and re-register on watcher return, and no
# PID/lock/helper state is ever created. No live KWin, no host mutation.
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BINARY="${TRAY_05B_BINARY:-}"
DBUS_RUN_SESSION="$(command -v dbus-run-session || true)"
DBUS_TEST_TOOL="$(command -v dbus-test-tool || true)"
BUSCTL="$(command -v busctl || true)"
TIMEOUT_BIN="$(command -v timeout || true)"
WORK="$(mktemp -d "$REPO_ROOT/.tray-05b.XXXXXX")"
PASS=0

cleanup() {
  rm -rf -- "$WORK"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

pass() {
  PASS=$((PASS + 1))
}

[[ -n "$DBUS_RUN_SESSION" ]] || fail "dbus-run-session is unavailable"
[[ -n "$DBUS_TEST_TOOL" ]] || fail "dbus-test-tool is unavailable"
[[ -n "$BUSCTL" ]] || fail "busctl is unavailable"
[[ -n "$TIMEOUT_BIN" ]] || fail "timeout is unavailable"

if [[ -z "$BINARY" ]]; then
  TRAY_OUT="$(nix build "$REPO_ROOT#tray" --no-link --no-update-lock-file --print-out-paths)" \
    || fail "Nix tray package build failed; pass TRAY_05B_BINARY for a worktree binary check"
  BINARY="$TRAY_OUT/bin/plasma-auto-tiler"
  [[ "$BINARY" == /nix/store/* ]] || fail "Nix tray output is not store-backed: $BINARY"
fi
[[ -f "$BINARY" && ! -L "$BINARY" && -x "$BINARY" ]] \
  || fail "tray binary is not a regular executable: $BINARY"
pass

# Static CLI surface: `tray` takes no arguments; the obsolete helper and
# managed commands are gone.
set +e
"$BINARY" tray extra-arg > "$WORK/argv.out" 2>&1
ARGV_CODE=$?
set -e
[[ "$ARGV_CODE" -eq 1 ]] || fail "tray with arguments exited $ARGV_CODE, expected 1"
pass
grep -Fq "tray takes no arguments" "$WORK/argv.out" || fail "tray argv error is not exact"
pass

for obsolete in tray-managed tray-install tray-start tray-status tray-stop tray-remove; do
  set +e
  "$BINARY" "$obsolete" > "$WORK/obsolete-$obsolete.out" 2>&1
  OBSOLETE_CODE=$?
  set -e
  [[ "$OBSOLETE_CODE" -eq 1 ]] || fail "$obsolete exited $OBSOLETE_CODE, expected 1"
  pass
  grep -Fq "unknown command: $obsolete" "$WORK/obsolete-$obsolete.out" \
    || fail "$obsolete error is not exact"
  pass
done

HOME_ROOT="$WORK/home"
DATA_ROOT="$WORK/data"
CONFIG_ROOT="$WORK/config"
RUNTIME_ROOT="$WORK/runtime"
mkdir -p -- "$HOME_ROOT" "$DATA_ROOT" "$CONFIG_ROOT" "$RUNTIME_ROOT"
chmod 700 "$HOME_ROOT" "$DATA_ROOT" "$CONFIG_ROOT" "$RUNTIME_ROOT"

SEQUENCE="$WORK/sequence.sh"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'PASS=0' \
  'pass() { PASS=$((PASS + 1)); }' \
  'WATCHER_PID=""' \
  'FIRST_PID=""' \
  'LATE_PID=""' \
  'cleanup_processes() {' \
  '  [[ -z "$FIRST_PID" ]] || { kill -TERM "$FIRST_PID" 2>/dev/null || true; wait "$FIRST_PID" 2>/dev/null || true; }' \
  '  [[ -z "$LATE_PID" ]] || { kill -TERM "$LATE_PID" 2>/dev/null || true; wait "$LATE_PID" 2>/dev/null || true; }' \
  '  [[ -z "$WATCHER_PID" ]] || { kill -TERM "$WATCHER_PID" 2>/dev/null || true; wait "$WATCHER_PID" 2>/dev/null || true; }' \
  '}' \
  'trap cleanup_processes EXIT' \
  '"$DBUS_TEST_TOOL" echo --session --name=org.kde.StatusNotifierWatcher > "$WORK/watcher.out" 2>&1 &' \
  'WATCHER_PID=$!' \
  'watcher_ready=0' \
  'for ((attempt = 0; attempt < 300; attempt += 1)); do' \
  '  if "$BUSCTL" --user status org.kde.StatusNotifierWatcher > /dev/null 2>&1; then watcher_ready=1; break; fi' \
  '  sleep 0.01' \
  'done' \
  '[[ "$watcher_ready" == 1 ]] || { cat "$WORK/watcher.out" >&2; exit 1; }' \
  'pass' \
  '"$tray_binary" tray > "$WORK/endpoint.out" 2>&1 &' \
  'FIRST_PID=$!' \
  'tray_ready=0' \
  'for ((attempt = 0; attempt < 300; attempt += 1)); do' \
  '  if "$BUSCTL" --user status org.plasmaautotiler.Tray > /dev/null 2>&1; then tray_ready=1; break; fi' \
  '  if ! kill -0 "$FIRST_PID" 2>/dev/null; then cat "$WORK/endpoint.out" >&2; exit 1; fi' \
  '  sleep 0.01' \
  'done' \
  '[[ "$tray_ready" == 1 ]] || { cat "$WORK/endpoint.out" >&2; exit 1; }' \
  'pass' \
  'acquired=0' \
  'for ((attempt = 0; attempt < 100; attempt += 1)); do' \
  '  if grep -Fq "outcome=acquired" "$WORK/endpoint.out" 2>/dev/null; then acquired=1; break; fi' \
  '  sleep 0.01' \
  'done' \
  '[[ "$acquired" == 1 ]] || { cat "$WORK/endpoint.out" >&2; exit 1; }' \
  'pass' \
  '[[ ! -e "$DATA_ROOT/plasma-auto-tiler" ]]' \
  'pass' \
  '[[ ! -e "$RUNTIME_ROOT/plasma-auto-tiler-managed" ]]' \
  'pass' \
  '[[ ! -e "$RUNTIME_ROOT/plasma-auto-tiler/tray.pid" ]]' \
  'pass' \
  '[[ ! -e "$CONFIG_ROOT/autostart/plasma-auto-tiler.desktop" ]]' \
  'pass' \
  'SECOND_CODE=0' \
  '"$TIMEOUT_BIN" 20 "$tray_binary" tray > "$WORK/second.out" 2>&1 || SECOND_CODE=$?' \
  '[[ "$SECOND_CODE" -eq 0 ]] || { cat "$WORK/second.out" >&2; exit 1; }' \
  'pass' \
  'grep -Fq "outcome=taken" "$WORK/second.out" || { cat "$WORK/second.out" >&2; exit 1; }' \
  'pass' \
  'kill -0 "$FIRST_PID" 2>/dev/null || { echo "first tray died after second invocation" >&2; exit 1; }' \
  'pass' \
  '"$BUSCTL" --user status org.plasmaautotiler.Tray > /dev/null 2>&1 || { echo "tray name lost after second invocation" >&2; exit 1; }' \
  'pass' \
  'kill -TERM "$WATCHER_PID"' \
  'WATCHER_PID=""' \
  'for ((attempt = 0; attempt < 300; attempt += 1)); do' \
  '  if "$BUSCTL" --user status org.kde.StatusNotifierWatcher > /dev/null 2>&1; then sleep 0.01; else break; fi' \
  'done' \
  '"$BUSCTL" --user status org.kde.StatusNotifierWatcher > /dev/null 2>&1 && { echo "watcher name still owned after kill" >&2; exit 1; } || true' \
  'stay_alive=1' \
  'for ((attempt = 0; attempt < 300; attempt += 1)); do' \
  '  if ! kill -0 "$FIRST_PID" 2>/dev/null; then stay_alive=0; break; fi' \
  '  sleep 0.01' \
  'done' \
  '[[ "$stay_alive" == 1 ]] || { echo "first tray died on watcher loss, expected stay-alive unregistered" >&2; exit 1; }' \
  'pass' \
  '"$BUSCTL" --user status org.plasmaautotiler.Tray > /dev/null 2>&1 || { echo "tray name lost on watcher loss" >&2; exit 1; }' \
  'pass' \
  '"$DBUS_TEST_TOOL" echo --session --name=org.kde.StatusNotifierWatcher > "$WORK/watcher2.out" 2>&1 &' \
  'WATCHER_PID=$!' \
  'watcher_ready=0' \
  'for ((attempt = 0; attempt < 300; attempt += 1)); do' \
  '  if "$BUSCTL" --user status org.kde.StatusNotifierWatcher > /dev/null 2>&1; then watcher_ready=1; break; fi' \
  '  sleep 0.01' \
  'done' \
  '[[ "$watcher_ready" == 1 ]] || { cat "$WORK/watcher2.out" >&2; exit 1; }' \
  'pass' \
  'for ((attempt = 0; attempt < 300; attempt += 1)); do' \
  '  if [[ "$(grep -c "stage=watcher event=register outcome=registered" "$WORK/endpoint.out" || true)" -ge 2 ]]; then break; fi' \
  '  sleep 0.01' \
  'done' \
  '[[ "$(grep -c "stage=watcher event=register outcome=registered" "$WORK/endpoint.out" || true)" -ge 2 ]] || { echo "tray did not re-register after watcher return" >&2; cat "$WORK/endpoint.out" >&2; exit 1; }' \
  'pass' \
  'kill -0 "$FIRST_PID" 2>/dev/null || { echo "first tray died on watcher return" >&2; exit 1; }' \
  'pass' \
  '"$BUSCTL" --user status org.plasmaautotiler.Tray > /dev/null 2>&1 || { echo "tray name lost on watcher return" >&2; exit 1; }' \
  'pass' \
  'kill -TERM "$FIRST_PID" 2>/dev/null || true' \
  'wait "$FIRST_PID" 2>/dev/null || true' \
  'FIRST_PID=""' \
  'for ((attempt = 0; attempt < 300; attempt += 1)); do' \
  '  if "$BUSCTL" --user status org.plasmaautotiler.Tray > /dev/null 2>&1; then sleep 0.01; else break; fi' \
  'done' \
  '[[ ! -e "$DATA_ROOT/plasma-auto-tiler" ]]' \
  'pass' \
  '[[ ! -e "$RUNTIME_ROOT/plasma-auto-tiler-managed" ]]' \
  'pass' \
  '[[ ! -e "$RUNTIME_ROOT/plasma-auto-tiler/tray.pid" ]]' \
  'pass' \
  '[[ ! -e "$CONFIG_ROOT/autostart/plasma-auto-tiler.desktop" ]]' \
  'pass' \
  'kill -TERM "$WATCHER_PID" 2>/dev/null || true' \
  'wait "$WATCHER_PID" 2>/dev/null || true' \
  'WATCHER_PID=""' \
  'for ((attempt = 0; attempt < 300; attempt += 1)); do' \
  '  if "$BUSCTL" --user status org.kde.StatusNotifierWatcher > /dev/null 2>&1; then sleep 0.01; else break; fi' \
  'done' \
  '"$tray_binary" tray > "$WORK/no-watcher.out" 2>&1 &' \
  'LATE_PID=$!' \
  'late_ready=0' \
  'for ((attempt = 0; attempt < 300; attempt += 1)); do' \
  '  if "$BUSCTL" --user status org.plasmaautotiler.Tray > /dev/null 2>&1; then late_ready=1; break; fi' \
  '  if ! kill -0 "$LATE_PID" 2>/dev/null; then cat "$WORK/no-watcher.out" >&2; exit 1; fi' \
  '  sleep 0.01' \
  'done' \
  '[[ "$late_ready" == 1 ]] || { cat "$WORK/no-watcher.out" >&2; exit 1; }' \
  'pass' \
  'late_alive=1' \
  'for ((attempt = 0; attempt < 200; attempt += 1)); do' \
  '  if ! kill -0 "$LATE_PID" 2>/dev/null; then late_alive=0; break; fi' \
  '  sleep 0.01' \
  'done' \
  '[[ "$late_alive" == 1 ]] || { echo "tray without watcher died, expected stay-alive unregistered" >&2; exit 1; }' \
  'pass' \
  'late_acquired=0' \
  'for ((attempt = 0; attempt < 100; attempt += 1)); do' \
  '  if grep -Fq "outcome=acquired" "$WORK/no-watcher.out" 2>/dev/null; then late_acquired=1; break; fi' \
  '  sleep 0.01' \
  'done' \
  '[[ "$late_acquired" == 1 ]] || { cat "$WORK/no-watcher.out" >&2; exit 1; }' \
  'pass' \
  'grep -Fq "stage=watcher event=startup outcome=absent" "$WORK/no-watcher.out" || { cat "$WORK/no-watcher.out" >&2; exit 1; }' \
  'pass' \
  '"$DBUS_TEST_TOOL" echo --session --name=org.kde.StatusNotifierWatcher > "$WORK/watcher3.out" 2>&1 &' \
  'WATCHER_PID=$!' \
  'watcher_ready=0' \
  'for ((attempt = 0; attempt < 300; attempt += 1)); do' \
  '  if "$BUSCTL" --user status org.kde.StatusNotifierWatcher > /dev/null 2>&1; then watcher_ready=1; break; fi' \
  '  sleep 0.01' \
  'done' \
  '[[ "$watcher_ready" == 1 ]] || { cat "$WORK/watcher3.out" >&2; exit 1; }' \
  'pass' \
  'for ((attempt = 0; attempt < 300; attempt += 1)); do' \
  '  if grep -Fq "stage=watcher event=register outcome=registered" "$WORK/no-watcher.out"; then break; fi' \
  '  sleep 0.01' \
  'done' \
  'grep -Fq "stage=watcher event=register outcome=registered" "$WORK/no-watcher.out" || { echo "tray did not register after watcher-less startup" >&2; cat "$WORK/no-watcher.out" >&2; exit 1; }' \
  'pass' \
  'kill -0 "$LATE_PID" 2>/dev/null || { echo "tray died on late watcher return" >&2; exit 1; }' \
  'pass' \
  '"$BUSCTL" --user status org.plasmaautotiler.Tray > /dev/null 2>&1 || { echo "tray name lost on late watcher return" >&2; exit 1; }' \
  'pass' \
  'kill -TERM "$LATE_PID" 2>/dev/null || true' \
  'wait "$LATE_PID" 2>/dev/null || true' \
  'LATE_PID=""' \
  'printf "05b tray single-instance fixture: %d passed\n" "$PASS"' > "$SEQUENCE"
chmod 700 "$SEQUENCE"

export BUSCTL DBUS_TEST_TOOL TIMEOUT_BIN DATA_ROOT CONFIG_ROOT RUNTIME_ROOT WORK
"$DBUS_RUN_SESSION" -- env \
  HOME="$HOME_ROOT" \
  XDG_DATA_HOME="$DATA_ROOT" \
  XDG_CONFIG_HOME="$CONFIG_ROOT" \
  XDG_RUNTIME_DIR="$RUNTIME_ROOT" \
  DBUS_TEST_TOOL="$DBUS_TEST_TOOL" \
  BUSCTL="$BUSCTL" \
  TIMEOUT_BIN="$TIMEOUT_BIN" \
  tray_binary="$BINARY" \
  "$SEQUENCE" \
  | tee "$WORK/sequence.out"
grep -Fq '05b tray single-instance fixture: 29 passed' "$WORK/sequence.out" \
  || fail "single-instance fixture count was not 29"
pass

printf '05b tray self-test: %d passed\n' "$PASS"
