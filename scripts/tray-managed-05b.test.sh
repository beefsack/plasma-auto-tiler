#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BINARY="${TRAY_05B_MANAGED_BINARY:-}"
DBUS_RUN_SESSION="$(command -v dbus-run-session || true)"
DBUS_TEST_TOOL="$(command -v dbus-test-tool || true)"
BUSCTL="$(command -v busctl || true)"
WORK="$(mktemp -d "$REPO_ROOT/.tray-managed-05b.XXXXXX")"

cleanup() {
  rm -rf -- "$WORK"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

[[ -n "$DBUS_RUN_SESSION" ]] || fail "dbus-run-session is unavailable"
[[ -n "$DBUS_TEST_TOOL" ]] || fail "dbus-test-tool is unavailable"
[[ -n "$BUSCTL" ]] || fail "busctl is unavailable"

if [[ -z "$BINARY" ]]; then
  TRAY_OUT="$(nix build "$REPO_ROOT#tray" --no-link --no-update-lock-file --print-out-paths)"
  BINARY="$TRAY_OUT/bin/plasma-auto-tiler"
fi
[[ "$BINARY" == /nix/store/* ]] || fail "managed binary is not in the Nix store: $BINARY"
[[ -f "$BINARY" && ! -L "$BINARY" && -x "$BINARY" ]] \
  || fail "managed binary is not a regular executable: $BINARY"

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
  'ENDPOINT_PID=""' \
  'cleanup_processes() {' \
  '  [[ -z "$ENDPOINT_PID" ]] || { kill -TERM "$ENDPOINT_PID" 2>/dev/null || true; wait "$ENDPOINT_PID" 2>/dev/null || true; }' \
  '  [[ -z "$WATCHER_PID" ]] || { kill -TERM "$WATCHER_PID" 2>/dev/null || true; wait "$WATCHER_PID" 2>/dev/null || true; }' \
  '}' \
  'trap cleanup_processes EXIT' \
  '"$DBUS_TEST_TOOL" echo --session --name=org.kde.StatusNotifierWatcher > "$WORK/watcher.out" 2>&1 &' \
  'WATCHER_PID=$!' \
  'watcher_ready=0' \
  'for ((attempt = 0; attempt < 100; attempt += 1)); do' \
  '  if "$BUSCTL" --user status org.kde.StatusNotifierWatcher > /dev/null 2>&1; then watcher_ready=1; break; fi' \
  '  sleep 0.01' \
  'done' \
  '[[ "$watcher_ready" == 1 ]] || { cat "$WORK/watcher.out" >&2; exit 1; }' \
  'pass' \
  'env -u PLASMA_AUTO_TILER_LAUNCH_DEV -u PLASMA_AUTO_TILER_LAUNCH_INO -u PLASMA_AUTO_TILER_LAUNCH_READY -u PLASMA_AUTO_TILER_LAUNCH_READY_DEV -u PLASMA_AUTO_TILER_LAUNCH_READY_INO "$managed_binary" tray-managed > "$WORK/endpoint.out" 2>&1 &' \
  'ENDPOINT_PID=$!' \
  'managed_pid="$RUNTIME_ROOT/plasma-auto-tiler-managed/tray.pid"' \
  'managed_ready=0' \
  'for ((attempt = 0; attempt < 200; attempt += 1)); do' \
  '  if [[ -f "$managed_pid" ]]; then managed_ready=1; break; fi' \
  '  if ! kill -0 "$ENDPOINT_PID" 2>/dev/null; then cat "$WORK/endpoint.out" >&2; exit 1; fi' \
  '  sleep 0.01' \
  'done' \
  '[[ "$managed_ready" == 1 ]] || { cat "$WORK/endpoint.out" >&2; exit 1; }' \
  'pass' \
  '[[ ! -e "$DATA_ROOT/plasma-auto-tiler" ]]' \
  'pass' \
  '[[ ! -e "$RUNTIME_ROOT/plasma-auto-tiler/tray.pid" ]]' \
  'pass' \
  'kill -TERM "$WATCHER_PID"' \
  'WATCHER_PID=""' \
  'for ((attempt = 0; attempt < 200; attempt += 1)); do' \
  '  if ! kill -0 "$ENDPOINT_PID" 2>/dev/null; then break; fi' \
  '  sleep 0.01' \
  'done' \
  'if kill -0 "$ENDPOINT_PID" 2>/dev/null; then cat "$WORK/endpoint.out" >&2; exit 1; fi' \
  'wait "$ENDPOINT_PID" || true' \
  'ENDPOINT_PID=""' \
  'pass' \
  '[[ ! -e "$managed_pid" ]]' \
  'pass' \
  'env -u PLASMA_AUTO_TILER_LAUNCH_DEV -u PLASMA_AUTO_TILER_LAUNCH_INO -u PLASMA_AUTO_TILER_LAUNCH_READY -u PLASMA_AUTO_TILER_LAUNCH_READY_DEV -u PLASMA_AUTO_TILER_LAUNCH_READY_INO "$managed_binary" tray-managed > "$WORK/no-watcher.out" 2>&1 &' \
  'ENDPOINT_PID=$!' \
  'for ((attempt = 0; attempt < 200; attempt += 1)); do' \
  '  if ! kill -0 "$ENDPOINT_PID" 2>/dev/null; then break; fi' \
  '  sleep 0.01' \
  'done' \
  'if kill -0 "$ENDPOINT_PID" 2>/dev/null; then cat "$WORK/no-watcher.out" >&2; exit 1; fi' \
  'wait "$ENDPOINT_PID" || true' \
  'ENDPOINT_PID=""' \
  'pass' \
  '[[ ! -e "$managed_pid" ]]' \
  'pass' \
  '[[ -z "${PLASMA_AUTO_TILER_LAUNCH_DEV-}" && -z "${PLASMA_AUTO_TILER_LAUNCH_INO-}" && -z "${PLASMA_AUTO_TILER_LAUNCH_READY-}" && -z "${PLASMA_AUTO_TILER_LAUNCH_READY_DEV-}" && -z "${PLASMA_AUTO_TILER_LAUNCH_READY_INO-}" ]]' \
  'pass' \
  'printf "05b managed lifecycle fixture: %d passed\n" "$PASS"' > "$SEQUENCE"
chmod 700 "$SEQUENCE"

export BUSCTL DBUS_TEST_TOOL DATA_ROOT RUNTIME_ROOT WORK
"$DBUS_RUN_SESSION" -- env \
  HOME="$HOME_ROOT" \
  XDG_DATA_HOME="$DATA_ROOT" \
  XDG_CONFIG_HOME="$CONFIG_ROOT" \
  XDG_RUNTIME_DIR="$RUNTIME_ROOT" \
  DBUS_TEST_TOOL="$DBUS_TEST_TOOL" \
  BUSCTL="$BUSCTL" \
  managed_binary="$BINARY" \
  "$SEQUENCE" \
  | tee "$WORK/sequence.out"

printf '05b managed self-test: 1 passed\n'
