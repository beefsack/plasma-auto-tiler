#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENDPOINT="$REPO_ROOT/src/tray_endpoint.rs"
SOURCE_BINARY="${TRAY_05A_SOURCE_BINARY:-$REPO_ROOT/target/release/plasma-auto-tiler}"
BASH_PATH="$(command -v bash)"
DBUS_RUN_SESSION="$(command -v dbus-run-session || true)"
DBUS_TEST_TOOL="$(command -v dbus-test-tool || true)"
WORK="$(mktemp -d "$REPO_ROOT/.tray-05a.XXXXXX")"
PASS=0

cleanup() {
  rm -rf -- "$WORK"
}
trap cleanup EXIT

pass() {
  PASS=$((PASS + 1))
}

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_static_contains() {
  local needle="$1"
  grep -Fq -- "$needle" "$ENDPOINT" || fail "endpoint is missing $needle"
  pass
}

assert_static_absent() {
  local needle="$1"
  ! grep -Eq -- "$needle" "$ENDPOINT" || fail "endpoint contains forbidden route $needle"
  pass
}

[[ -f "$SOURCE_BINARY" && ! -L "$SOURCE_BINARY" && -x "$SOURCE_BINARY" ]] \
  || fail "release source binary is not a regular executable: $SOURCE_BINARY"
[[ -n "$DBUS_RUN_SESSION" ]] || fail "dbus-run-session is unavailable"
[[ -n "$DBUS_TEST_TOOL" ]] || fail "dbus-test-tool is unavailable"
assert_static_contains 'pub const METHOD: &str = "PublishSnapshot";'
assert_static_absent 'Command::new|qdbus|KGlobalAccel|xdotool|wtype|shell|input'

HOME_ROOT="$WORK/home"
DATA_ROOT="$WORK/data"
CONFIG_ROOT="$WORK/config"
RUNTIME_ROOT="$WORK/runtime"
SOURCE_ROOT="$WORK/source"
mkdir -p -- "$HOME_ROOT" "$DATA_ROOT" "$CONFIG_ROOT" "$RUNTIME_ROOT" "$SOURCE_ROOT"
chmod 700 "$HOME_ROOT" "$DATA_ROOT" "$CONFIG_ROOT" "$RUNTIME_ROOT" "$SOURCE_ROOT"

# Cargo release artifacts may have two hard links. Copy into the private
# fixture so the production installer receives a one-link regular executable.
SOURCE_COPY="$SOURCE_ROOT/plasma-auto-tiler"
cp --reflink=never -- "$SOURCE_BINARY" "$SOURCE_COPY"
chmod 755 "$SOURCE_COPY"
[[ -f "$SOURCE_COPY" && ! -L "$SOURCE_COPY" && -x "$SOURCE_COPY" ]] \
  || fail "source copy is not a regular executable"
[[ "$(stat -c '%h' "$SOURCE_COPY")" == 1 ]] || fail "source copy is not one-link"
pass

INSTALLED_BINARY="$DATA_ROOT/plasma-auto-tiler/bin/plasma-auto-tiler"
SEQUENCE="$WORK/sequence.sh"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'PASS=0' \
  'pass() { PASS=$((PASS + 1)); }' \
  'source_binary="$1"' \
  'installed_binary="$2"' \
  'WATCHER_PID=""' \
  'cleanup_watcher() { [[ -z "$WATCHER_PID" ]] || { kill "$WATCHER_PID" 2>/dev/null || true; wait "$WATCHER_PID" 2>/dev/null || true; }; }' \
  'trap cleanup_watcher EXIT' \
  '"$DBUS_TEST_TOOL" echo --session --name=org.kde.StatusNotifierWatcher > "$WORK/watcher.out" 2>&1 &' \
  'WATCHER_PID=$!' \
  'watcher_ready=0' \
  'for ((attempt = 0; attempt < 100; attempt += 1)); do' \
  '  if busctl --user status org.kde.StatusNotifierWatcher > /dev/null 2>&1; then watcher_ready=1; break; fi' \
  '  sleep 0.01' \
  'done' \
  '[[ "$watcher_ready" == 1 ]] || { cat "$WORK/watcher.out" >&2; exit 1; }' \
  'pass' \
  'unset PLASMA_AUTO_TILER_LAUNCH_DEV PLASMA_AUTO_TILER_LAUNCH_INO PLASMA_AUTO_TILER_LAUNCH_READY PLASMA_AUTO_TILER_LAUNCH_READY_DEV PLASMA_AUTO_TILER_LAUNCH_READY_INO' \
  '[[ -z "${PLASMA_AUTO_TILER_LAUNCH_DEV-}" && -z "${PLASMA_AUTO_TILER_LAUNCH_INO-}" && -z "${PLASMA_AUTO_TILER_LAUNCH_READY-}" && -z "${PLASMA_AUTO_TILER_LAUNCH_READY_DEV-}" && -z "${PLASMA_AUTO_TILER_LAUNCH_READY_INO-}" ]]' \
  'pass' \
  'run() {' \
  '  local name="$1"; shift' \
  '  "$@" > "$WORK/$name.out" 2>&1 || {' \
  '    printf "FAIL: %s command failed\n" "$name" >&2' \
  '    cat "$WORK/$name.out" >&2' \
  '    exit 1' \
  '  }; pass' \
  '}' \
  'contains() { grep -Fq -- "$2" "$WORK/$1.out"; pass; }' \
  'run install "$source_binary" tray-install' \
  '[[ -f "$installed_binary" && ! -L "$installed_binary" ]]' \
  'pass' \
  '[[ "$(stat -c "%h %a" "$installed_binary")" == "1 755" ]]' \
  'pass' \
  'run status-before "$installed_binary" tray-status' \
  'contains status-before "status: stopped"' \
  'run start "$installed_binary" tray-start' \
  'run status-running "$installed_binary" tray-status' \
  'contains status-running "status: running"' \
  'run stop "$installed_binary" tray-stop' \
  'contains stop "stop: stopped helper"' \
  'run status-after "$installed_binary" tray-status' \
  'contains status-after "status: stopped"' \
  'run remove "$source_binary" tray-remove' \
  '[[ ! -e "$installed_binary" ]]' \
  'pass' \
  '[[ ! -e "$DATA_ROOT/plasma-auto-tiler" ]]' \
  'pass' \
  '[[ ! -e "$CONFIG_ROOT/autostart/plasma-auto-tiler.desktop" ]]' \
  'pass' \
  '[[ ! -e "$RUNTIME_ROOT/plasma-auto-tiler/tray.pid" ]]' \
  'pass' \
  'printf "05a direct lifecycle sequence: %d passed\n" "$PASS"' > "$SEQUENCE"
chmod 700 "$SEQUENCE"

export WORK DATA_ROOT CONFIG_ROOT RUNTIME_ROOT
"$DBUS_RUN_SESSION" -- env \
  HOME="$HOME_ROOT" \
  XDG_DATA_HOME="$DATA_ROOT" \
  XDG_CONFIG_HOME="$CONFIG_ROOT" \
  XDG_RUNTIME_DIR="$RUNTIME_ROOT" \
  DBUS_TEST_TOOL="$DBUS_TEST_TOOL" \
  PLASMA_AUTO_TILER_LAUNCH_DEV=forged-dev \
  PLASMA_AUTO_TILER_LAUNCH_INO=forged-ino \
  PLASMA_AUTO_TILER_LAUNCH_READY=/forged/ready \
  PLASMA_AUTO_TILER_LAUNCH_READY_DEV=forged-ready-dev \
  PLASMA_AUTO_TILER_LAUNCH_READY_INO=forged-ready-ino \
  "$BASH_PATH" "$SEQUENCE" "$SOURCE_COPY" "$INSTALLED_BINARY" \
  | tee "$WORK/sequence.out"
grep -Fq '05a direct lifecycle sequence: 19 passed' "$WORK/sequence.out" \
  || fail "direct lifecycle sequence count was not 19"
pass

printf '05a self-test: %d passed\n' "$PASS"
