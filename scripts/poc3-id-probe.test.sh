#!/usr/bin/env bash
# Static tests for the nested-only POC3 read-only ID/eligibility probe.
#
# No live execution: never runs busctl transport, dbus-run-session, nested
# KWin, GUI clients, planner, or host KWin. All PID/proc/bus inputs are
# synthetic fixtures; every nested invocation fails closed before transport.
# Bundle builds are local esbuild file writes to kwin/dist only.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TOOL="$REPO_ROOT/scripts/poc3-id-probe.sh"
HELPER="$REPO_ROOT/scripts/poc3-build-id-probe.mjs"
PROBE_LOGIC="$REPO_ROOT/kwin/src/poc3-id-probe.ts"
PROBE_ENTRY="$REPO_ROOT/kwin/src/poc3-id-probe-entry.ts"
LAUNCHER="$REPO_ROOT/scripts/nested-kwin-spike.sh"
WORK="$(mktemp -d)"
OUTPUT="$(mktemp)"
PASS=0
FAIL=0

cleanup() {
  rm -rf "$WORK"
  rm -f "$OUTPUT"
  rm -f "$REPO_ROOT/kwin/dist/poc3-id-probe.js"
}
trap cleanup EXIT

BASH_BIN="$(command -v bash)"
STAT_BIN="$(command -v stat)"
SHA_BIN="$(command -v sha256sum)"
KILL_BIN="$(command -v kill)"
READLINK_BIN="$(command -v readlink)"
BUSCTL_BIN="$(command -v busctl)"
JQ_BIN="$(command -v jq)"
NODE_BIN="$(command -v node)"
GREP_BIN="$(command -v grep)"
TAIL_BIN="$(command -v tail)"
WC_BIN="$(command -v wc)"
SLEEP_BIN="$(command -v sleep)"
HEAD_BIN="$(command -v head)"
FAKE_KWIN_674="$WORK/kwin-6.7.4/bin/kwin_wayland"
FAKE_MANUAL_A="$WORK/manual-a/client-a"
FAKE_MANUAL_B="$WORK/manual-b/client-b"
FAKE_MANUAL_C="$WORK/manual-c/client-c"

setup_fake_kwin() {
  mkdir -p "$WORK/kwin-6.7.4/bin" "$WORK/manual-a" "$WORK/manual-b" "$WORK/manual-c"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_KWIN_674"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_MANUAL_A"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_MANUAL_B"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_MANUAL_C"
  chmod +x "$FAKE_KWIN_674" "$FAKE_MANUAL_A" "$FAKE_MANUAL_B" "$FAKE_MANUAL_C"
}

proc_fixture() {
  local pid="$1" tick="$2" exe="$3"
  local dir="$WORK/proc/$pid"
  mkdir -p "$dir"
  local fields="S"
  local k
  for ((k = 1; k < 19; k += 1)); do fields+=' 0'; done
  fields+=" $tick"
  printf '%s (kwin_wayland) %s\n' "$pid" "$fields" > "$dir/stat"
  rm -f "$dir/exe"
  ln -s "$exe" "$dir/exe"
}

nested_env_fixture() {
  local wd="$1" pid="${2:-2222}"
  local dir="$WORK/proc/$pid"
  mkdir -p "$dir/fd"
  rm -f "$dir/fd"/* 2>/dev/null || true
  rm -f "$dir/maps" 2>/dev/null || true
  local bus="unix:path=$wd/runtime/bus"
  printf '%s\0' \
    "HOME=$wd" \
    "XDG_CONFIG_HOME=$wd/config" \
    "XDG_DATA_HOME=$wd/data" \
    "XDG_CACHE_HOME=$wd/cache" \
    "XDG_STATE_HOME=$wd/state" \
    "XDG_RUNTIME_DIR=$wd/runtime" \
    "KDEHOME=$wd" \
    "DBUS_SESSION_BUS_ADDRESS=$bus" \
    > "$dir/environ"
  printf '%s\0' "$FAKE_KWIN_674" "--socket=$wd/runtime/nested-kwin-spike" > "$dir/cmdline"
}

write_valid_manifest() {
  local wd="$1"
  mkdir -p "$wd/config" "$wd/cache" "$wd/data" "$wd/state" "$wd/runtime"
  chmod 700 "$wd/runtime"
  python3 -c "import socket; s=socket.socket(socket.AF_UNIX); s.bind('$wd/runtime/nested-kwin-spike')" 2>/dev/null || true
  local dev_ino kwin_canon kwin_sha kwin_devino
  dev_ino="$("$STAT_BIN" -c '%d:%i' -- "$wd")"
  kwin_canon="$(readlink -f -- "$FAKE_KWIN_674")"
  kwin_sha="$(sha256sum -- "$kwin_canon" | awk '{print $1}')"
  kwin_devino="$("$STAT_BIN" -c '%d:%i' -- "$kwin_canon")"
  cat > "$wd/manifest" <<EOF
schema=nested-kwin-manifest-v2
status=ready
workdir=$wd
workdir_dev=${dev_ino%%:*}
workdir_ino=${dev_ino##*:}
kwin_bin=$FAKE_KWIN_674
kwin_bin_canonical=$kwin_canon
kwin_bin_sha256=$kwin_sha
kwin_bin_dev=${kwin_devino%%:*}
kwin_bin_ino=${kwin_devino##*:}
kwin_version=6.7.4
host_display=$WORK/host-runtime/wayland-0
host_runtime=$WORK/host-runtime
host_uid=$(id -u)
xdg_config_home=$wd/config
xdg_data_home=$wd/data
xdg_cache_home=$wd/cache
xdg_state_home=$wd/state
xdg_runtime_dir=$wd/runtime
kdehome=$wd
nested_socket_name=nested-kwin-spike
nested_socket_path=$wd/runtime/nested-kwin-spike
bus_path=$wd/bus.txt
bus_address=unix:path=$wd/runtime/bus
log_path=$wd/nested.log
launcher_pid=3333
launcher_starttick=333300
launcher_exe=/fake/dbus-supervisor
nested_pid=2222
nested_starttick=222200
nested_exe=$FAKE_KWIN_674
nested_exe_canonical=$kwin_canon
nested_exe_sha256=$kwin_sha
nested_exe_dev=${kwin_devino%%:*}
nested_exe_ino=${kwin_devino##*:}
host_kwinrc_path=$WORK/fake-kwinrc
host_kwinrc_state=present
host_kwinrc_sha256=5e6fb76e94a616ef0bfdd0f26229116eb77804442ae8330aeb5634e878914abe
host_kwinrc_mtime=2026-09-04 11:51:21.670154832 +1000
EOF
  printf 'unix:path=%s/runtime/bus' "$wd" > "$wd/bus.txt"
  printf 'nested log start\n' > "$wd/nested.log"
  nested_env_fixture "$wd" 2222
}

reset_fixtures() {
  rm -rf "$WORK/proc" "$WORK/host-runtime" "$WORK/case"
  mkdir -p "$WORK/proc" "$WORK/host-runtime" "$WORK/case"
  rm -f "$WORK/host-runtime/wayland-0"
  python3 -c "import socket; s=socket.socket(socket.AF_UNIX); s.bind('$WORK/host-runtime/wayland-0')" 2>/dev/null || : > "$WORK/host-runtime/wayland-0"
  proc_fixture 2222 222200 "$FAKE_KWIN_674"
  proc_fixture 3333 333300 /fake/dbus-supervisor
}

run_probe() {
  local wd="$1"
  shift
  set +e
  PROC_ROOT="$WORK/proc" STAT_BIN="$STAT_BIN" SHA256SUM_BIN="$SHA_BIN" \
    KILL_BIN="$KILL_BIN" READLINK_BIN="$READLINK_BIN" BUSCTL_BIN="$BUSCTL_BIN" JQ_BIN="$JQ_BIN" \
    NODE_BIN="$NODE_BIN" GREP_BIN="$GREP_BIN" TAIL_BIN="$TAIL_BIN" WC_BIN="$WC_BIN" \
    SLEEP_BIN="$SLEEP_BIN" HEAD_BIN="$HEAD_BIN" \
    KWIN_EXPECTED_VERSION=6.7.4 DBUS_SESSION_BUS_ADDRESS="unix:path=$WORK/host-runtime/bus" \
    POC3_ID_PROBE_NESTED_ALLOW=1 NESTED_KWIN_TEST_ALLOW_NONSTORE=1 \
    "$BASH_BIN" "$TOOL" nested "$wd" probe --owner owner-1 --generation gen-1 --nonce n-1 "$@" >"$OUTPUT" 2>&1
  VALID_EXIT=$?
  set -e
}

run_cleanup() {
  local wd="$1" sid="$2"
  set +e
  PROC_ROOT="$WORK/proc" STAT_BIN="$STAT_BIN" SHA256SUM_BIN="$SHA_BIN" \
    KILL_BIN="$KILL_BIN" READLINK_BIN="$READLINK_BIN" BUSCTL_BIN="$BUSCTL_BIN" JQ_BIN="$JQ_BIN" \
    NODE_BIN="$NODE_BIN" GREP_BIN="$GREP_BIN" TAIL_BIN="$TAIL_BIN" WC_BIN="$WC_BIN" \
    SLEEP_BIN="$SLEEP_BIN" HEAD_BIN="$HEAD_BIN" \
    KWIN_EXPECTED_VERSION=6.7.4 DBUS_SESSION_BUS_ADDRESS="unix:path=$WORK/host-runtime/bus" \
    POC3_ID_PROBE_NESTED_ALLOW=1 NESTED_KWIN_TEST_ALLOW_NONSTORE=1 \
    "$BASH_BIN" "$TOOL" nested "$wd" cleanup "$sid" >"$OUTPUT" 2>&1
  VALID_EXIT=$?
  set -e
}

expect_fail_contains() {
  local name="$1" needle="$2"
  if [[ "$VALID_EXIT" -ne 0 ]] && grep -Fq "$needle" "$OUTPUT"; then
    PASS=$((PASS + 1))
    printf 'pass: %s\n' "$name"
  else
    printf 'FAIL: %s (expected failure containing "%s", exit %s)\n' "$name" "$needle" "$VALID_EXIT" >&2
    cat "$OUTPUT" >&2
    FAIL=$((FAIL + 1))
  fi
}

pass() { PASS=$((PASS + 1)); printf 'pass: %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$1" >&2; }

setup_fake_kwin
printf 'kwinrc-fixture\n' > "$WORK/fake-kwinrc"

# 1. syntax + help
if "$BASH_BIN" -n "$TOOL"; then pass "bash -n syntax"; else fail "bash -n syntax"; fi
if node --check "$HELPER"; then pass "node --check helper"; else fail "node --check helper"; fi
if "$BASH_BIN" "$TOOL" --help 2>&1 | grep -Fq "poc3-id-probe-done"; then pass "--help documents probe done marker"; else fail "--help documents probe done marker"; fi
if "$BASH_BIN" "$TOOL" nested 2>/dev/null; then fail "bare nested must fail"; else pass "bare nested fails"; fi

# 2. disabled by default
reset_fixtures
write_valid_manifest "$WORK/case/valid-disabled"
set +e
PROC_ROOT="$WORK/proc" STAT_BIN="$STAT_BIN" SHA256SUM_BIN="$SHA_BIN" \
  KWIN_EXPECTED_VERSION=6.7.4 DBUS_SESSION_BUS_ADDRESS="unix:path=$WORK/host-runtime/bus" \
  env -u POC3_ID_PROBE_NESTED_ALLOW \
  "$BASH_BIN" "$TOOL" nested "$WORK/case/valid-disabled" probe --owner owner-1 --generation gen-1 --nonce n-1 >"$OUTPUT" 2>&1
VALID_EXIT=$?
set -e
expect_fail_contains "disabled by default" "disabled by default"

# 3. absent manifest
reset_fixtures
mkdir -p "$WORK/case/absent"
run_probe "$WORK/case/absent"
expect_fail_contains "absent manifest fails closed" "manifest"

# 4. malformed manifest
reset_fixtures
write_valid_manifest "$WORK/case/malformed"
printf 'not a kv line!!!\n' >> "$WORK/case/malformed/manifest"
run_probe "$WORK/case/malformed"
expect_fail_contains "malformed manifest fails closed" "malformed"

# 5. interrupted manifest
reset_fixtures
write_valid_manifest "$WORK/case/interrupted"
sed -i 's|^status=.*|status=starting|' "$WORK/case/interrupted/manifest"
sed -i '/^nested_pid=/d; /^nested_starttick=/d; /^nested_exe=/d; /^nested_exe_canonical=/d; /^nested_exe_sha256=/d; /^nested_exe_dev=/d; /^nested_exe_ino=/d' "$WORK/case/interrupted/manifest"
run_probe "$WORK/case/interrupted"
expect_fail_contains "interrupted manifest fails closed" "interrupted"

# 6. tampered workdir
reset_fixtures
write_valid_manifest "$WORK/case/tampered"
sed -i 's|^workdir=.*|workdir=/tmp/evil|' "$WORK/case/tampered/manifest"
run_probe "$WORK/case/tampered"
expect_fail_contains "tampered workdir fails closed" "does not match"

# 7. identity mismatch
reset_fixtures
write_valid_manifest "$WORK/case/identity"
proc_fixture 2222 999999 "$FAKE_KWIN_674"
run_probe "$WORK/case/identity"
expect_fail_contains "identity mismatch fails closed" "start-tick mismatch"

# 8. host bus refusal
reset_fixtures
write_valid_manifest "$WORK/case/hostbus"
sed -i "s|^bus_address=.*|bus_address=unix:path=$WORK/host-runtime/bus|" "$WORK/case/hostbus/manifest"
printf 'unix:path=%s' "$WORK/host-runtime/bus" > "$WORK/case/hostbus/bus.txt"
run_probe "$WORK/case/hostbus"
expect_fail_contains "host bus refusal fails closed" "host"

# 9. missing private bus / log
reset_fixtures
write_valid_manifest "$WORK/case/nobus"
rm -f "$WORK/case/nobus/bus.txt"
run_probe "$WORK/case/nobus"
expect_fail_contains "absent private bus fails closed" "bus"
reset_fixtures
write_valid_manifest "$WORK/case/nolog"
rm -f "$WORK/case/nolog/nested.log"
run_probe "$WORK/case/nolog"
expect_fail_contains "absent private log fails closed" "log"

# 10. bus content mismatch
reset_fixtures
write_valid_manifest "$WORK/case/busmismatch"
printf 'unix:path=/tmp/evil/bus' > "$WORK/case/busmismatch/bus.txt"
run_probe "$WORK/case/busmismatch"
expect_fail_contains "bus content mismatch fails closed" "does not match"

# 10b. M3: sibling prefix and embedded host runtime are rejected
reset_fixtures
mkdir -p "$WORK/a"
write_valid_manifest "$WORK/a"
sed -i "s|^bus_address=.*|bus_address=unix:path=$WORK/a-evil/runtime/bus|" "$WORK/a/manifest"
printf 'unix:path=%s' "$WORK/a-evil/runtime/bus" > "$WORK/a/bus.txt"
run_probe "$WORK/a"
expect_fail_contains "sibling bus prefix rejected" "does not bind"
reset_fixtures
write_valid_manifest "$WORK/case/embedded"
sed -i "s|^bus_address=.*|bus_address=unix:path=$WORK/case/embedded/runtime/bus;unix:path=$WORK/host-runtime/bus|" "$WORK/case/embedded/manifest"
printf 'unix:path=%s/runtime/bus;unix:path=%s/bus' "$WORK/case/embedded" "$WORK/host-runtime" > "$WORK/case/embedded/bus.txt"
run_probe "$WORK/case/embedded"
expect_fail_contains "embedded host runtime rejected" "does not bind"

# 11. explicit script ID parsing: cleanup rejects bad IDs before transport
reset_fixtures
write_valid_manifest "$WORK/case/cleanup-id"
for bad in -1 2147483648 abc ""; do
  run_cleanup "$WORK/case/cleanup-id" "$bad"
  expect_fail_contains "cleanup rejects script id '$bad'" "script ID"
done

# 12. helper validation vectors (static, local build only)
helper_ok() {
  if node "$HELPER" "$@" --out "$REPO_ROOT/kwin/dist/poc3-id-probe.js" >/dev/null 2>&1; then
    pass "helper accepts: $*"
  else
    fail "helper accepts: $*"
  fi
  rm -f "$REPO_ROOT/kwin/dist/poc3-id-probe.js"
}
helper_rejects() {
  if node "$HELPER" "$@" --out "$REPO_ROOT/kwin/dist/poc3-id-probe.js" >/dev/null 2>&1; then
    fail "helper rejects: $*"
  else
    pass "helper rejects: $*"
  fi
  rm -f "$REPO_ROOT/kwin/dist/poc3-id-probe.js"
}
helper_ok --owner owner-1 --generation gen-1 --nonce n-1 --expected-pids 4441,4442,4443
helper_rejects --owner 'BAD OWNER' --generation gen-1 --nonce n-1 --expected-pids 4441,4442,4443
helper_rejects --owner owner-1 --generation GEN-1 --nonce n-1 --expected-pids 4441,4442,4443
helper_rejects --owner owner-1 --generation gen-1 --expected-pids 4441,4442,4443
helper_rejects --owner owner-1 --generation gen-1 --nonce n-1
helper_rejects --owner owner-1 --generation gen-1 --nonce n-1 --expected-pids 4441,4442 --out "$REPO_ROOT/kwin/dist/poc3-id-probe.js"
helper_rejects --owner owner-1 --generation gen-1 --nonce n-1 --expected-pids 4441,4441,4442 --out "$REPO_ROOT/kwin/dist/poc3-id-probe.js"
helper_rejects --owner owner-1 --generation gen-1 --nonce n-1 --expected-pids '4441,4442;touch' --out "$REPO_ROOT/kwin/dist/poc3-id-probe.js"
helper_rejects --owner owner-1 --generation gen-1 --nonce n-1 --expected-pids 4441,4442,4443 --out "$REPO_ROOT/kwin/dist/poc3-manual-command.js"
helper_rejects --owner owner-1 --generation gen-1 --nonce n-1 --expected-pids 4441,4442,4443 --out /tmp/evil.js

# 13. generated bundle constraints (local build, then inspect)
node "$HELPER" --owner owner-1 --generation gen-1 --nonce n-1 --expected-pids 4441,4442,4443 --out "$REPO_ROOT/kwin/dist/poc3-id-probe.js" >/dev/null 2>&1
if [[ -f "$REPO_ROOT/kwin/dist/poc3-id-probe.js" ]]; then pass "probe bundle builds to fixed dist path"; else fail "probe bundle builds to fixed dist path"; fi
BUNDLE_FILE="$REPO_ROOT/kwin/dist/poc3-id-probe.js"
if grep -q '^"use strict";' "$BUNDLE_FILE" && grep -q '(() =>' "$BUNDLE_FILE"; then pass "probe bundle is IIFE"; else fail "probe bundle is IIFE"; fi
if grep -qE '^[[:space:]]*(import|export)[[:space:]]' "$BUNDLE_FILE"; then fail "probe bundle must not contain ESM"; else pass "probe bundle has no ESM"; fi
if grep -q 'sourceMappingURL' "$BUNDLE_FILE"; then fail "probe bundle must not contain source maps"; else pass "probe bundle has no source maps"; fi
if grep -qE 'catch[[:space:]]*\{' "$BUNDLE_FILE"; then fail "probe bundle must not contain optional catch bindings"; else pass "probe bundle has no optional catch bindings"; fi
if grep -q 'node:' "$BUNDLE_FILE"; then fail "probe bundle must not contain node imports"; else pass "probe bundle has no node imports"; fi
if grep -q 'poc3-id-probe-done:' "$BUNDLE_FILE"; then pass "probe bundle contains done marker"; else fail "probe bundle contains done marker"; fi
if grep -Fq 'POC3_ID_PROBE_EXPECTED_PIDS_JSON' "$REPO_ROOT/scripts/poc3-build-id-probe.mjs" && grep -Fq '4441' "$BUNDLE_FILE"; then pass "probe bundle embeds exact manual PIDs"; else fail "probe bundle embeds exact manual PIDs"; fi
if grep -Fq 'POC3_DIAG_SLOT_APP_IDS' "$PROBE_LOGIC" && grep -Fq 'poc3-slot-mismatch' "$PROBE_LOGIC" && grep -Fq 'readDiagSlotHint' "$PROBE_LOGIC"; then pass "probe cross-checks bounded slot app_id/title evidence where supported"; else fail "probe cross-checks bounded slot app_id/title evidence where supported"; fi
if grep -Fq 'guessed-ID fallback' "$PROBE_LOGIC"; then fail "probe must not use guessed-ID fallback"; else pass "probe has no guessed-ID fallback"; fi
if grep -Fq 'orderedIds' "$PROBE_LOGIC" && grep -Fq 'idByPid' "$PROBE_LOGIC"; then pass "probe emits deterministic slot-ordered IDs for command route"; else fail "probe emits deterministic slot-ordered IDs for command route"; fi
if grep -Fq 'poc3-pid-duplicate' "$PROBE_LOGIC" && grep -Fq 'poc3-id-probe-count' "$PROBE_LOGIC"; then pass "probe rejects fourth matching and same-PID windows"; else fail "probe rejects fourth matching and same-PID windows"; fi
if grep -Fq 'readProp(candidate, "pid")' "$PROBE_LOGIC" && grep -Fq 'poc3-pid-mismatch' "$PROBE_LOGIC" && grep -Fq 'poc3-no-pid' "$PROBE_LOGIC" && grep -Fq 'POC3_ID_PROBE_EXPECTED_PID_COUNT = 3' "$PROBE_LOGIC"; then pass "probe binds exactly three distinct manual PIDs via client.pid"; else fail "probe binds exactly three distinct manual PIDs via client.pid"; fi
rm -f "$REPO_ROOT/kwin/dist/poc3-id-probe.js"

# 14. nested transport shape: explicit address, private log only, exact ID lifecycle
NESTED_SECTION="$(mktemp)"
sed -n '/nested_validate_manifest/,/^fi$/p' "$TOOL" > /dev/null 2>&1 || true
TOOL_SRC="$TOOL"
if grep -Fq -- "--user" <(sed -n '/nested_cmd_probe/,/^}/p' "$TOOL_SRC"); then
  fail "nested probe route contains --user"
else
  pass "nested probe route has no --user"
fi
if grep -Fq "journalctl" <(sed -n '/nested_cmd_probe/,/^}/p' "$TOOL_SRC"); then
  fail "nested probe route contains journalctl"
else
  pass "nested probe route has no journalctl"
fi
if grep -Fq -- '--address="$NESTED_BUS_ADDRESS"' "$TOOL_SRC" || grep -Fq -- '--address=' "$TOOL_SRC"; then pass "nested route uses busctl --address="; else fail "nested route uses busctl --address="; fi
if [[ "$(grep -c "nested_validate_manifest" "$TOOL_SRC")" -ge 2 ]] && [[ "$(grep -c "nested_load_private_state" "$TOOL_SRC")" -ge 2 ]]; then
  pass "nested validates manifest first and private state again"
else
  fail "nested validates manifest first and private state again"
fi
if grep -Fq 'load_valid' "$TOOL_SRC" && grep -Fq '/Scripting/Script$' "$TOOL_SRC" && grep -Fq 'org.kde.kwin.Script' "$TOOL_SRC"; then
  pass "explicit script ID parsing/unload shape"
else
  fail "explicit script ID parsing/unload shape"
fi
if grep -Fq 'unloadScript s "$PLUGIN"' "$TOOL_SRC" && grep -Fq 'not-loaded' "$TOOL_SRC"; then
  pass "exact unload verified not-loaded"
else
  fail "exact unload verified not-loaded"
fi
rm -f "$NESTED_SECTION"

# 15. zero actuation: probe sources contain no geometry/focus/close/config writes
for forbidden in "frameGeometry =" "activeWindow =" "closeWindow(" "callDBus(" "readConfig(" "createDesktop(" "removeDesktop(" "setCurrentDesktop(" "showOutline(" "registerShortcut" 'loadScript ss' 'unloadScript s'; do
  if grep -Fq "$forbidden" "$PROBE_LOGIC" || grep -Fq "$forbidden" "$PROBE_ENTRY"; then
    fail "probe contains forbidden actuation: $forbidden"
  else
    pass "probe absent actuation: $forbidden"
  fi
done
if grep -Fq "console.log" "$PROBE_ENTRY"; then pass "probe emits via console.log (private log)"; else fail "probe emits via console.log (private log)"; fi

# 16. fixed separate identity: no production package or POC2 probe reuse
if grep -Fq 'PLUGIN="poc3-id-probe"' "$TOOL" && grep -Fq 'dist/poc3-id-probe.js' "$TOOL"; then
  pass "fixed separate plugin/bundle identity"
else
  fail "fixed separate plugin/bundle identity"
fi
if grep -Fq "plasma-auto-tiler-kwin" "$PROBE_LOGIC" || grep -Fq "plasma-auto-tiler-kwin" "$PROBE_ENTRY"; then
  fail "probe reuses production package"
else
  pass "probe does not reuse production package"
fi
if grep -Fq 'from "./planner-shadow"' "$PROBE_LOGIC" || grep -Fq 'from "./planner-shadow"' "$PROBE_ENTRY" || grep -Fq 'planner-shadow-probe' "$TOOL" || grep -Fq 'build:planner-probe' "$TOOL"; then
  fail "probe reuses POC2 probe"
else
  pass "probe does not reuse POC2 probe"
fi
if grep -Fq "poc3-manual-command" "$TOOL"; then fail "probe reuses POC3 command bundle"; else pass "probe does not reuse POC3 command bundle"; fi
if grep -Fq "poc3-id-probe" "$REPO_ROOT/kwin/src/entry.ts"; then fail "production entry imports probe"; else pass "production entry does not import probe"; fi

# 17. production behavior remains explicit
if grep -Fq 'PRODUCTION_PLUGIN="plasma-auto-tiler-kwin"' "$TOOL"; then pass "production guard remains explicit"; else fail "production guard remains explicit"; fi

# 18. final-delta: build helper regular-file check, lock serialization, unload shape
if grep -Fq 'probe build helper is unavailable or symlinked' "$TOOL" && grep -Fq '! -L "$BUILD_HELPER"' "$TOOL"; then pass "build helper regular non-symlink check"; else fail "build helper regular non-symlink check"; fi
if [[ -f "$REPO_ROOT/scripts/poc3-build-id-probe.mjs" && ! -L "$REPO_ROOT/scripts/poc3-build-id-probe.mjs" ]]; then pass "build helper is a regular file"; else fail "build helper is a regular file"; fi
if grep -Fq 'probe_lock_acquire' "$TOOL" && grep -Fq 'no lost update' "$TOOL" && grep -Fq 'manifest.lock' "$TOOL"; then pass "probe serializes mutations with dependency-free lock"; else fail "probe serializes mutations with dependency-free lock"; fi
if grep -Fq 'probe_rollback_record' "$TOOL" && grep -Fq 'nested_cleanup_loaded' "$TOOL"; then pass "post-record failure unloads and rolls back (shape)"; else fail "post-record failure unloads and rolls back (shape)"; fi
if grep -Fq 'NESTED_MANIFEST_SH:=' "$TOOL" || grep -Fq 'NESTED_MANIFEST_SH=' "$TOOL"; then pass "manifest helper path is pinned"; else fail "manifest helper path is pinned"; fi

# 19. private-env isolation: missing/malformed/host-leaking environ fails closed
reset_fixtures
write_valid_manifest "$WORK/case/penv-missing"
rm -f "$WORK/proc/2222/environ"
run_probe "$WORK/case/penv-missing"
expect_fail_contains "private-env missing fails closed" "private environment"
reset_fixtures
write_valid_manifest "$WORK/case/penv-malformed"
WD="$WORK/case/penv-malformed"
printf '%s\0' \
  "HOME=/tmp/evil" \
  "XDG_CONFIG_HOME=$WD/config" \
  "XDG_DATA_HOME=$WD/data" \
  "XDG_CACHE_HOME=$WD/cache" \
  "XDG_STATE_HOME=$WD/state" \
  "XDG_RUNTIME_DIR=$WD/runtime" \
  "KDEHOME=$WD" \
  "DBUS_SESSION_BUS_ADDRESS=unix:path=$WD/runtime/bus" \
  > "$WORK/proc/2222/environ"
run_probe "$WORK/case/penv-malformed"
expect_fail_contains "private-env malformed fails closed" "does not match"
reset_fixtures
write_valid_manifest "$WORK/case/penv-leak"
WD="$WORK/case/penv-leak"
printf '%s\0' \
  "HOME=$WD" \
  "XDG_CONFIG_HOME=$WD/config" \
  "XDG_DATA_HOME=$WD/data" \
  "XDG_CACHE_HOME=$WD/cache" \
  "XDG_STATE_HOME=$WD/state" \
  "XDG_RUNTIME_DIR=$WD/runtime" \
  "KDEHOME=$WD" \
  "DBUS_SESSION_BUS_ADDRESS=unix:path=$WD/runtime/bus" \
  "EVIL_LEAK=$WORK/fake-kwinrc" \
  > "$WORK/proc/2222/environ"
run_probe "$WORK/case/penv-leak"
expect_fail_contains "private-env host leak fails closed" "path leakage"

# 20. manual-route binding: exactly three live manifest-recorded manual PIDs
# Full extended identity (bin/canonical/sha/dev/ino/pid/tick/exe/argc/argv)
# plus live /proc fixtures, so the exact manual ready validator is exercised.
write_full_manual_slot() {
  local wd="$1" slot="$2" pid="$3" tick="$4" bin="$5"
  local canon sha devino argv_sha
  canon="$(readlink -f -- "$bin")"
  sha="$(sha256sum -- "$canon" | awk '{print $1}')"
  devino="$("$STAT_BIN" -c '%d:%i' -- "$canon")"
  argv_sha="$(printf '%s\0' "$bin" "slot$slot" | sha256sum | awk '{print $1}')"
  proc_fixture "$pid" "$tick" "$canon"
  if ! grep -q -e '^manual_count=' -- "$wd/manifest"; then
    printf 'manual_count=3\n' >> "$wd/manifest"
  fi
  cat >> "$wd/manifest" <<EOF
manual_${slot}_bin=$bin
manual_${slot}_bin_canonical=$canon
manual_${slot}_bin_sha256=$sha
manual_${slot}_bin_dev=${devino%%:*}
manual_${slot}_bin_ino=${devino##*:}
manual_${slot}_pid=$pid
manual_${slot}_starttick=$tick
manual_${slot}_exe=$canon
manual_${slot}_argc=2
manual_${slot}_argv_sha256=$argv_sha
EOF
}
write_manual_trio() {
  local wd="$1" p1="${2:-4441}" p2="${3:-4442}" p3="${4:-4443}"
  write_full_manual_slot "$wd" 1 "$p1" 444100 "$FAKE_MANUAL_A"
  write_full_manual_slot "$wd" 2 "$p2" 444200 "$FAKE_MANUAL_B"
  write_full_manual_slot "$wd" 3 "$p3" 444300 "$FAKE_MANUAL_C"
}
reset_fixtures
write_valid_manifest "$WORK/case/manual-missing"
run_probe "$WORK/case/manual-missing"
expect_fail_contains "manual missing fails closed" "manual group is not ready"
if [[ -f "$REPO_ROOT/kwin/dist/poc3-id-probe.js" ]]; then fail "missing manual must never build bundle"; else pass "missing manual never builds bundle"; fi
reset_fixtures
write_valid_manifest "$WORK/case/manual-partial"
write_full_manual_slot "$WORK/case/manual-partial" 1 4441 444100 "$FAKE_MANUAL_A"
run_probe "$WORK/case/manual-partial"
expect_fail_contains "manual partial fails closed" "not ready"
if [[ -f "$REPO_ROOT/kwin/dist/poc3-id-probe.js" ]]; then fail "partial manual must never build bundle"; else pass "partial manual never builds bundle"; fi
reset_fixtures
write_valid_manifest "$WORK/case/manual-dup"
write_manual_trio "$WORK/case/manual-dup" 4441 4441 4443
run_probe "$WORK/case/manual-dup"
expect_fail_contains "manual duplicate PIDs rejected" "distinct"
if [[ -f "$REPO_ROOT/kwin/dist/poc3-id-probe.js" ]]; then fail "duplicate PIDs must never build bundle"; else pass "duplicate PIDs never build bundle"; fi
reset_fixtures
write_valid_manifest "$WORK/case/manual-disposable"
write_manual_trio "$WORK/case/manual-disposable"
mkdir -p "$WORK/bin"
printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/bin/weston-terminal"
chmod +x "$WORK/bin/weston-terminal"
_WC="$(readlink -f -- "$WORK/bin/weston-terminal")"
_WS="$("$SHA_BIN" -- "$_WC" | awk '{print $1}')"
_WD="$("$STAT_BIN" -c '%d:%i' -- "$_WC")"
cat >> "$WORK/case/manual-disposable/manifest" <<EOF
client_count=3
client_bin=$WORK/bin/weston-terminal
client_bin_canonical=$_WC
client_bin_sha256=$_WS
client_bin_dev=${_WD%%:*}
client_bin_ino=${_WD##*:}
client_1_pid=5551
client_1_starttick=555100
client_1_exe=$_WC
client_2_pid=5552
client_2_starttick=555200
client_2_exe=$_WC
client_3_pid=5553
client_3_starttick=555300
client_3_exe=$_WC
EOF
run_probe "$WORK/case/manual-disposable"
expect_fail_contains "disposable mixing refused via manual branch" "mix modes"
if [[ -f "$REPO_ROOT/kwin/dist/poc3-id-probe.js" ]]; then fail "client-mix must never build bundle"; else pass "client-mix never builds bundle"; fi
# Stale/reused PID: tick mismatch must fail closed with no build.
reset_fixtures
write_valid_manifest "$WORK/case/manual-stale"
write_manual_trio "$WORK/case/manual-stale"
proc_fixture 4442 999999 "$(readlink -f -- "$FAKE_MANUAL_B")"
run_probe "$WORK/case/manual-stale"
expect_fail_contains "stale/reused PID fails closed" "start-tick mismatch"
if [[ -f "$REPO_ROOT/kwin/dist/poc3-id-probe.js" ]]; then fail "stale PID must never build bundle"; else pass "stale PID never builds bundle"; fi
# Incomplete manual extended identity: drop sha/dev/ino for slot 2.
reset_fixtures
write_valid_manifest "$WORK/case/manual-incomplete"
write_manual_trio "$WORK/case/manual-incomplete"
sed -i '/^manual_2_bin_sha256=/d; /^manual_2_bin_dev=/d; /^manual_2_bin_ino=/d' "$WORK/case/manual-incomplete/manifest"
run_probe "$WORK/case/manual-incomplete"
expect_fail_contains "incomplete manual extended identity fails closed" "partial manual"
if [[ -f "$REPO_ROOT/kwin/dist/poc3-id-probe.js" ]]; then fail "incomplete extended must never build bundle"; else pass "incomplete extended never builds bundle"; fi
# Manual helper binding: exact repo script, exact Nix Bash, allow env scoped.
if grep -Fq 'resolve_manual_sh' "$TOOL" && grep -Fq 'override is rejected' "$TOOL" && grep -Fq 'NESTED_MANUAL_CLIENTS_ALLOW=1' "$TOOL"; then pass "manual helper bound to exact repo script with scoped allow env"; else fail "manual helper bound to exact repo script with scoped allow env"; fi
if grep -Fq 'nested_validate_manual_ready' "$TOOL" && [[ "$(grep -c 'nested_validate_manual_ready' "$TOOL")" -ge 3 ]]; then pass "full ready validation before build and before transport"; else fail "full ready validation before build and before transport"; fi
if grep -Fq 'resolve_spawn_shell' "$TOOL" && grep -Fq '/nix/store/*' "$TOOL"; then pass "exact Nix Bash binding for manual validator"; else fail "exact Nix Bash binding for manual validator"; fi
if grep -Fq 'nested_load_manual_pids' "$TOOL" && grep -Fq -- '--expected-pids "$MANUAL_PIDS"' "$TOOL" && grep -Fq 'manual_count' "$TOOL"; then pass "shell loads exact three manual PIDs without injection (shape)"; else fail "shell loads exact three manual PIDs without injection (shape)"; fi
if grep -Fq '"caption"' "$TOOL" || grep -Fq '"desktopFileName"' "$TOOL" || grep -Fq '"resourceName"' "$TOOL" || grep -Fq '"title"' "$TOOL" || grep -Fq '"appId"' "$TOOL"; then fail "shell uses no captions/app IDs/titles"; else pass "shell uses no captions/app IDs/titles"; fi
if grep -Fq 'POC3_ID_PROBE_EXPECTED_PIDS_JSON' "$HELPER" && grep -Fq -- '--expected-pids' "$HELPER"; then pass "build helper carries exact PID list as fixed input"; else fail "build helper carries exact PID list as fixed input"; fi
# Bundle symlink guard: precreated output symlink must fail closed with no target write.
reset_fixtures
write_valid_manifest "$WORK/case/bundle-symlink"
write_manual_trio "$WORK/case/bundle-symlink"
mkdir -p "$REPO_ROOT/kwin/dist"
printf 'symlink-target-sentinel\n' > "$WORK/bundle-target.txt"
rm -f "$REPO_ROOT/kwin/dist/poc3-id-probe.js"
ln -s "$WORK/bundle-target.txt" "$REPO_ROOT/kwin/dist/poc3-id-probe.js"
BEFORE_TARGET="$(cat -- "$WORK/bundle-target.txt")"
run_probe "$WORK/case/bundle-symlink"
expect_fail_contains "bundle symlink refused" "symlink"
AFTER_TARGET="$(cat -- "$WORK/bundle-target.txt")"
if [[ "$BEFORE_TARGET" == "$AFTER_TARGET" && "$AFTER_TARGET" == "symlink-target-sentinel" ]]; then pass "bundle symlink target untouched (no overwrite)"; else fail "bundle symlink target untouched (no overwrite)"; fi
if [[ -L "$REPO_ROOT/kwin/dist/poc3-id-probe.js" ]]; then pass "bundle symlink preserved (no replacement)"; else fail "bundle symlink preserved (no replacement)"; fi
rm -f "$REPO_ROOT/kwin/dist/poc3-id-probe.js"
# Pinned tool authority: no bare PATH execution for security-sensitive tools.
if grep -Eq '(^|[^"$A-Z_/])\bnode[[:space:]]+"\$BUILD_HELPER"' "$TOOL"; then fail "node must use pinned absolute path"; else pass "node uses pinned absolute path"; fi
if grep -Fq '"$NODE_BIN"' "$TOOL" && grep -Fq '"$BUSCTL_BIN"' "$TOOL" && grep -Fq '"$JQ_BIN"' "$TOOL" && grep -Fq '"$GREP_BIN"' "$TOOL" && grep -Fq '"$TAIL_BIN"' "$TOOL" && grep -Fq '"$SLEEP_BIN"' "$TOOL"; then pass "pinned tool authority for node/busctl/jq/grep/tail/sleep"; else fail "pinned tool authority for node/busctl/jq/grep/tail/sleep"; fi
if grep -Fq 'command -v "$tool"' "$TOOL"; then fail "no bare PATH fallback loop"; else pass "no bare PATH fallback loop"; fi
# Bounded log scan: fixed byte window plus fixed-length diagnostic, no O(n^2) tail.
if grep -Fq 'PROBE_LOG_WINDOW_BYTES=65536' "$TOOL" && grep -Fq 'PROBE_DIAG_LIMIT=1024' "$TOOL" && grep -Fq '"$TAIL_BIN" -c "$PROBE_LOG_WINDOW_BYTES"' "$TOOL"; then pass "bounded log window with pinned tail"; else fail "bounded log window with pinned tail"; fi
if grep -Fq 'tail -n +"' "$TOOL"; then fail "no unlimited tail from offset"; else pass "no unlimited tail from offset"; fi
# Noisy/long diagnostic stays bounded: 200KiB newline-rich log with marker at end.
NOISY_LOG="$WORK/noisy-private.log"
python3 -c "open('$NOISY_LOG','w').write(('N'*1024+'\n')*200 + 'poc3-id-probe-done:n-1\n')"
BOUNDED_OUT="$("$TAIL_BIN" -c 65536 -- "$NOISY_LOG" 2>/dev/null | "$GREP_BIN" -F -- 'poc3-id-probe-done:n-1' | "$TAIL_BIN" -n 1 | "$HEAD_BIN" -c 1024)"
if [[ -n "$BOUNDED_OUT" ]] && [[ "${#BOUNDED_OUT}" -le 1024 ]] && grep -Fq 'poc3-id-probe-done:n-1' <<<"$BOUNDED_OUT"; then pass "noisy log diagnostic bounded to ${#BOUNDED_OUT} bytes"; else fail "noisy log diagnostic bounded to ${#BOUNDED_OUT} bytes"; fi
rm -f "$NOISY_LOG"

# 21. remediated review findings: validated AWK in trio guard, post-transport revalidation.
# 21b. pinned mutation-tool authority: lock/staging/bundle/bus paths use
# validated store executables, never bare PATH names or fallbacks.
if grep -Fq '"$MKDIR_BIN"' "$TOOL" && grep -Fq '"$RMDIR_BIN"' "$TOOL" && grep -Fq '"$MKTEMP_BIN"' "$TOOL" \
  && grep -Fq '"$CP_BIN"' "$TOOL" && grep -Fq '"$MV_BIN"' "$TOOL" && grep -Fq '"$RM_BIN"' "$TOOL" \
  && grep -Fq '"$CAT_BIN"' "$TOOL" && grep -Fq '"$DIRNAME_BIN"' "$TOOL"; then pass "probe pins mkdir/rmdir/mktemp/cp/mv/rm/cat/dirname"; else fail "probe pins mkdir/rmdir/mktemp/cp/mv/rm/cat/dirname"; fi
if grep -Fq 'resolve_mkdir_bin' "$TOOL" && grep -Fq 'MKDIR_BIN="$(resolve_mkdir_bin)"' "$TOOL" \
  && grep -Fq 'resolve_dirname_bin' "$TOOL" && grep -Fq 'DIRNAME_BIN="$(resolve_dirname_bin)"' "$TOOL"; then pass "probe pins mutation tools before use in both entries"; else fail "probe pins mutation tools before use in both entries"; fi
if ! grep -v -E '^[[:space:]]*#' "$TOOL" | grep -Fq '|| sleep'; then pass "probe has no bare sleep fallback"; else fail "probe has no bare sleep fallback"; fi
# Hostile pinned mutation tool fails closed at entry before any transport.
mkdir -p "$WORK/hostile-bin"
printf '#!/usr/bin/env bash\necho evil-mkdir\n' > "$WORK/hostile-bin/mkdir"
chmod +x "$WORK/hostile-bin/mkdir"
set +e
PROC_ROOT=/proc STAT_BIN="$STAT_BIN" SHA256SUM_BIN="$SHA_BIN" \
  KILL_BIN="$KILL_BIN" READLINK_BIN="$READLINK_BIN" BUSCTL_BIN="$BUSCTL_BIN" JQ_BIN="$JQ_BIN" \
  NODE_BIN="$NODE_BIN" GREP_BIN="$GREP_BIN" TAIL_BIN="$TAIL_BIN" WC_BIN="$WC_BIN" \
  SLEEP_BIN="$SLEEP_BIN" HEAD_BIN="$HEAD_BIN" AWK_BIN="$(command -v awk)" \
  MKDIR_BIN="$WORK/hostile-bin/mkdir" \
  POC3_ID_PROBE_NESTED_ALLOW=1 NESTED_KWIN_TEST_ALLOW_NONSTORE=0 \
  "$BASH_BIN" "$TOOL" nested "$WORK/case/hostile-mkdir-absent" probe --owner owner-1 --generation gen-1 --nonce n-1 >"$OUTPUT" 2>&1
VALID_EXIT=$?
set -e
_hm_ok=1
[[ "$VALID_EXIT" -ne 0 ]] || _hm_ok=0
grep -Fq "mkdir must be exact Nix/devenv" "$OUTPUT" || _hm_ok=0
[[ ! -e "$WORK/case/hostile-mkdir-absent" ]] || _hm_ok=0
if [[ "$_hm_ok" -eq 1 ]]; then pass "hostile mkdir pin fails closed with no workdir"; else fail "hostile mkdir pin fails closed with no workdir"; fi
# Hostile canonicalizer identity (store binary, wrong basename) fails closed.
set +e
PROC_ROOT=/proc STAT_BIN="$STAT_BIN" SHA256SUM_BIN="$SHA_BIN" \
  KILL_BIN="$KILL_BIN" READLINK_BIN="$STAT_BIN" BUSCTL_BIN="$BUSCTL_BIN" JQ_BIN="$JQ_BIN" \
  NODE_BIN="$NODE_BIN" GREP_BIN="$GREP_BIN" TAIL_BIN="$TAIL_BIN" WC_BIN="$WC_BIN" \
  SLEEP_BIN="$SLEEP_BIN" HEAD_BIN="$HEAD_BIN" AWK_BIN="$(command -v awk)" \
  POC3_ID_PROBE_NESTED_ALLOW=1 NESTED_KWIN_TEST_ALLOW_NONSTORE=0 \
  "$BASH_BIN" "$TOOL" nested "$WORK/case/hostile-rl-absent" probe --owner owner-1 --generation gen-1 --nonce n-1 >"$OUTPUT" 2>&1
VALID_EXIT=$?
set -e
if [[ "$VALID_EXIT" -ne 0 ]] && grep -Fq "exact Nix/devenv" "$OUTPUT"; then pass "wrong-basename store canonicalizer fails closed"; else fail "wrong-basename store canonicalizer fails closed"; fi
if grep -Fq 'resolve_awk_bin' "$TOOL" && grep -Fq 'AWK_BIN="$(resolve_awk_bin)"' "$TOOL"; then pass "probe resolves validated AWK tool (resolver retained elsewhere)"; else fail "probe resolves validated AWK tool (resolver retained elsewhere)"; fi
TRIO_GUARD_BODY="$(awk '/^nested_require_trio_guard\(\)/,/^}/' "$TOOL")"
if printf '%s' "$TRIO_GUARD_BODY" | grep -Fq '##*) ' && printf '%s' "$TRIO_GUARD_BODY" | grep -Fq '_stat_fields[19]' && printf '%s' "$TRIO_GUARD_BODY" | grep -Fq '"$READLINK_BIN"'; then pass "trio guard uses manifest-compatible Bash parser with pinned readlink"; else fail "trio guard uses manifest-compatible Bash parser with pinned readlink"; fi
if printf '%s' "$TRIO_GUARD_BODY" | grep -Fq 'AWK_BIN'; then fail "trio guard must not invoke AWK"; else pass "trio guard does not invoke AWK"; fi
if printf '%s' "$TRIO_GUARD_BODY" | grep -Fq '${AWK_BIN:-awk}'; then fail "trio guard has no AWK bare fallback"; else pass "trio guard has no AWK bare fallback"; fi
if grep -Fq 'MANUAL_PIDS_POST' "$TOOL" && grep -Fq 'manual PIDs changed after transport' "$TOOL" && grep -Fq 'trio guard no longer validates after transport' "$TOOL" && grep -Fq 'manual identities no longer validate after transport' "$TOOL"; then pass "H5 post-transport manual/PID/trio revalidation before record"; else fail "H5 post-transport manual/PID/trio revalidation before record"; fi

# 22. pinned canonical jq execution: a symlink chain from a profile path
# resolves to a regular exact /nix/store final and the command actually
# invoked is that canonical path (never the input symlink), proven end-to-end
# at a safe pre-transport point (absent WORKDIR, production mode, real /proc).
if grep -Fq 'pinned_jq_pretransport_check' "$TOOL" && grep -Fq 'profile symlink must never execute' "$TOOL" && grep -Fq 'pinned_jq_pretransport_check || exit 1' "$TOOL"; then pass "pinned jq pre-transport check present in probe and cleanup (shape)"; else fail "pinned jq pre-transport check present in probe and cleanup (shape)"; fi
PROFILE_JQ_CAND="$(command -v jq)"
if [[ -L "$PROFILE_JQ_CAND" ]]; then pass "profile jq input is a symlink chain ($PROFILE_JQ_CAND)"; else fail "profile jq input is a symlink chain ($PROFILE_JQ_CAND)"; fi
CANON_REAL="$(readlink -f -- "$PROFILE_JQ_CAND")"
if [[ "$CANON_REAL" == /nix/store/* ]] && [[ -f "$CANON_REAL" && ! -L "$CANON_REAL" ]] && [[ -x "$CANON_REAL" ]] && [[ "${CANON_REAL##*/}" == "jq" ]]; then pass "profile chain resolves to regular exact /nix/store final ($CANON_REAL)"; else fail "profile chain resolves to regular exact /nix/store final ($CANON_REAL)"; fi
mkdir -p "$WORK/fake-hm/bin" "$WORK/fake-profile/bin"
ln -sf "$CANON_REAL" "$WORK/fake-hm/bin/jq"
ln -sf "$WORK/fake-hm/bin/jq" "$WORK/fake-profile/bin/jq"
SYNTH_JQ="$WORK/fake-profile/bin/jq"
SYNTH_CANON="$(readlink -f -- "$SYNTH_JQ")"
if [[ "$SYNTH_CANON" == "$CANON_REAL" ]] && [[ -f "$SYNTH_CANON" && ! -L "$SYNTH_CANON" ]]; then pass "synthetic profile-like chain resolves to same regular final"; else fail "synthetic profile-like chain resolves to same regular final"; fi
eval "$(for _fn in nested_safe_abs store_readlink_bin resolve_store_tool resolve_jq_bin pinned_jq_pretransport_check; do awk "/^${_fn}\(\)/,/^}/" "$TOOL"; echo; done)"
if [[ "$(NESTED_KWIN_TEST_ALLOW_NONSTORE=0 JQ_BIN="$PROFILE_JQ_CAND" READLINK_BIN="$READLINK_BIN" resolve_jq_bin 2>/dev/null)" == "$CANON_REAL" ]]; then pass "resolver pins profile input to canonical final"; else fail "resolver pins profile input to canonical final"; fi
if [[ "$(NESTED_KWIN_TEST_ALLOW_NONSTORE=0 JQ_BIN="$SYNTH_JQ" READLINK_BIN="$READLINK_BIN" resolve_jq_bin 2>/dev/null)" == "$CANON_REAL" ]]; then pass "resolver pins synthetic chain to canonical final"; else fail "resolver pins synthetic chain to canonical final"; fi
if NESTED_KWIN_TEST_ALLOW_NONSTORE=0 JQ_BIN="$CANON_REAL" READLINK_BIN="$READLINK_BIN" pinned_jq_pretransport_check 2>/dev/null; then pass "pinned check executes canonical jq on fixed input"; else fail "pinned check executes canonical jq on fixed input"; fi
STORE_AWK_BIN="$(command -v awk)"
STORE_KILL_BIN="$(type -P kill 2>/dev/null || printf '%s' "$KILL_BIN")"
run_canon_probe() {
  local input_jq="$1" case_dir="$2"
  mkdir -p "$case_dir"
  set +e
  PROC_ROOT=/proc STAT_BIN="$STAT_BIN" SHA256SUM_BIN="$SHA_BIN" \
    KILL_BIN="$STORE_KILL_BIN" READLINK_BIN="$READLINK_BIN" BUSCTL_BIN="$BUSCTL_BIN" JQ_BIN="$input_jq" \
    NODE_BIN="$NODE_BIN" GREP_BIN="$GREP_BIN" TAIL_BIN="$TAIL_BIN" WC_BIN="$WC_BIN" \
    SLEEP_BIN="$SLEEP_BIN" HEAD_BIN="$HEAD_BIN" AWK_BIN="$STORE_AWK_BIN" \
    KWIN_EXPECTED_VERSION=6.7.4 DBUS_SESSION_BUS_ADDRESS="unix:path=$WORK/host-runtime/bus" \
    POC3_ID_PROBE_NESTED_ALLOW=1 NESTED_KWIN_TEST_ALLOW_NONSTORE=0 \
    "$BASH_BIN" -x "$TOOL" nested "$case_dir" probe --owner owner-1 --generation gen-1 --nonce n-1 >"$OUTPUT" 2>&1
  VALID_EXIT=$?
  set -e
}
run_canon_probe "$PROFILE_JQ_CAND" "$WORK/case/canon-jq-profile-absent"
if [[ "$VALID_EXIT" -ne 0 ]] && grep -Fq "manifest" "$OUTPUT" && ! grep -Fq "pinned jq" "$OUTPUT"; then pass "profile input passes pre-transport jq and fails on absent manifest (no transport)"; else fail "profile input passes pre-transport jq and fails on absent manifest (no transport)"; fi
if grep -Fq "+ $CANON_REAL -e" "$OUTPUT"; then pass "trace proves canonical jq executed (profile input)"; else fail "trace proves canonical jq executed (profile input)"; fi
if grep -Fq "+ $PROFILE_JQ_CAND -e" "$OUTPUT"; then fail "profile symlink must never execute as command"; else pass "profile symlink never executed as command"; fi
run_canon_probe "$SYNTH_JQ" "$WORK/case/canon-jq-synth-absent"
if [[ "$VALID_EXIT" -ne 0 ]] && grep -Fq "manifest" "$OUTPUT" && ! grep -Fq "pinned jq" "$OUTPUT"; then pass "synthetic chain passes pre-transport jq and fails on absent manifest"; else fail "synthetic chain passes pre-transport jq and fails on absent manifest"; fi
if grep -Fq "+ $CANON_REAL -e" "$OUTPUT"; then pass "trace proves canonical jq executed (synthetic input)"; else fail "trace proves canonical jq executed (synthetic input)"; fi
if grep -Fq "+ $SYNTH_JQ -e" "$OUTPUT"; then fail "synthetic input symlink must never execute as command"; else pass "synthetic input symlink never executed as command"; fi

# 23. supervisor trio guard focused regressions: manifest-compatible Bash
# parser (no duplicate production parser; exercises the sourced guard only).
eval "$(for _fn in nested_manifest_get nested_require_trio_guard; do awk "/^${_fn}\(\)/,/^}/" "$TOOL"; echo; done)"
GUARD_PROC="$WORK/guard-proc"
GUARD_MANIFEST="$WORK/guard-manifest"
GUARD_EXE="$WORK/guard-bin/sup"
mkdir -p "$WORK/guard-bin"
printf '#!/usr/bin/env bash\nexit 0\n' > "$GUARD_EXE"
chmod +x "$GUARD_EXE"
guard_fields() {
  local tick="$1" f="S" k
  for ((k = 1; k < 19; k += 1)); do f+=' 0'; done
  f+=" $tick"
  printf '%s' "$f"
}
guard_write_sup() {
  cat > "$GUARD_MANIFEST" <<EOF
diag_supervisor_pid=$1
diag_supervisor_starttick=$2
diag_supervisor_exe=$3
diag_supervisor_bin=$GUARD_EXE
diag_supervisor_bin_canonical=$GUARD_EXE
diag_supervisor_bin_sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
diag_supervisor_bin_dev=1
diag_supervisor_bin_ino=2
diag_supervisor_diag_path=$WORK/guard-diag.log
EOF
}
guard_write_stat() {
  mkdir -p "$GUARD_PROC/$1"
  printf '%s (%s) %s\n' "$1" "$2" "$(guard_fields "$3")" > "$GUARD_PROC/$1/stat"
  rm -f "$GUARD_PROC/$1/exe"
  ln -s "$4" "$GUARD_PROC/$1/exe"
}
guard_run() {
  PROC_ROOT="$GUARD_PROC"
  set +e
  nested_require_trio_guard "$GUARD_MANIFEST" "4441,4442,4443" >"$OUTPUT" 2>&1
  VALID_EXIT=$?
  set -e
}
# Valid supervisor identity passes.
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
guard_write_stat 5555 sup 555500 "$GUARD_EXE"
guard_run
if [[ "$VALID_EXIT" -eq 0 ]]; then pass "trio guard accepts valid supervisor identity"; else fail "trio guard accepts valid supervisor identity"; fi
# Comm with spaces passes (splits after the last ") ").
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
guard_write_stat 5555 "my supervisor v1" 555500 "$GUARD_EXE"
guard_run
if [[ "$VALID_EXIT" -eq 0 ]]; then pass "trio guard accepts comm with spaces"; else fail "trio guard accepts comm with spaces"; fi
# Comm with parentheses passes.
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
guard_write_stat 5555 "my)sup (v1)" 555500 "$GUARD_EXE"
guard_run
if [[ "$VALID_EXIT" -eq 0 ]]; then pass "trio guard accepts comm with parentheses"; else fail "trio guard accepts comm with parentheses"; fi
# Malformed stat fails closed as unreadable.
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
mkdir -p "$GUARD_PROC/5555"
printf 'garbage-without-paren\n' > "$GUARD_PROC/5555/stat"
rm -f "$GUARD_PROC/5555/exe"; ln -s "$GUARD_EXE" "$GUARD_PROC/5555/exe"
guard_run
expect_fail_contains "trio guard rejects malformed stat" "unreadable"
# Missing proc stat fails closed as stale/unreadable.
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
guard_run
expect_fail_contains "trio guard rejects missing proc stat" "stale or unreadable"
# Start-tick mismatch fails closed (PID reuse suspected).
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
guard_write_stat 5555 sup 999999 "$GUARD_EXE"
guard_run
expect_fail_contains "trio guard rejects start-tick mismatch" "start-tick mismatch"
# Shell quoting/tool-injection safety: malicious PID never executes.
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
rm -f "$WORK/guard-pwned"
guard_write_sup '5555;touch "$WORK/guard-pwned"' 555500 "$GUARD_EXE"
guard_write_stat 5555 sup 555500 "$GUARD_EXE"
guard_run
expect_fail_contains "trio guard rejects injected supervisor PID" "positive integer"
if [[ -e "$WORK/guard-pwned" ]]; then fail "injected PID must never execute"; else pass "injected PID never executed"; fi
# Injection-looking comm is data only: valid tick/exe still passes, nothing executes.
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
rm -f "$WORK/guard-pwned2"
guard_write_sup 5555 555500 "$GUARD_EXE"
guard_write_stat 5555 'x$(touch "$WORK/guard-pwned2")y' 555500 "$GUARD_EXE"
guard_run
if [[ "$VALID_EXIT" -eq 0 ]]; then pass "trio guard treats injection-looking comm as data"; else fail "trio guard treats injection-looking comm as data"; fi
if [[ -e "$WORK/guard-pwned2" ]]; then fail "injection-looking comm must never execute"; else pass "injection-looking comm never executed"; fi
# Executable mismatch fails closed (live exe differs from the record).
GUARD_EXE_OTHER="$WORK/guard-bin/other-sup"
printf '#!/usr/bin/env bash\nexit 0\n' > "$GUARD_EXE_OTHER"
chmod +x "$GUARD_EXE_OTHER"
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
guard_write_stat 5555 sup 555500 "$GUARD_EXE_OTHER"
guard_run
expect_fail_contains "trio guard rejects executable mismatch" "executable mismatch"
# " (deleted)" exe target fails closed as unreadable.
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
guard_write_stat 5555 sup 555500 "$GUARD_EXE (deleted)"
guard_run
expect_fail_contains "trio guard rejects deleted exe target" "unreadable"
# Relative exe target fails closed as unreadable.
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
guard_write_stat 5555 sup 555500 "relative/sup-target"
guard_run
expect_fail_contains "trio guard rejects relative exe target" "unreadable"
# Dangling absolute exe target fails closed (does not match the record).
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
rm -f "$WORK/guard-bin/nonexistent-sup"
guard_write_sup 5555 555500 "$GUARD_EXE"
guard_write_stat 5555 sup 555500 "$WORK/guard-bin/nonexistent-sup"
guard_run
expect_fail_contains "trio guard rejects dangling exe target" "executable mismatch"
# Missing exe symlink fails closed as unreadable.
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
guard_write_stat 5555 sup 555500 "$GUARD_EXE"
rm -f "$GUARD_PROC/5555/exe"
guard_run
expect_fail_contains "trio guard rejects missing exe symlink" "unreadable"
# Supervisor PID collision with the enrolled manual PIDs fails closed.
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 4442 555500 "$GUARD_EXE"
guard_write_stat 4442 sup 555500 "$GUARD_EXE"
guard_run
expect_fail_contains "trio guard rejects supervisor PID collision" "collides"
# Partial diag_supervisor records fail closed as ambiguous.
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
guard_write_stat 5555 sup 555500 "$GUARD_EXE"
sed -i '/^diag_supervisor_starttick=/d' "$GUARD_MANIFEST"
guard_run
expect_fail_contains "trio guard rejects partial record without starttick" "partial supervisor"
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
guard_write_stat 5555 sup 555500 "$GUARD_EXE"
sed -i '/^diag_supervisor_bin_sha256=/d' "$GUARD_MANIFEST"
guard_run
expect_fail_contains "trio guard rejects partial record without bin hash" "partial supervisor"
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
guard_write_stat 5555 sup 555500 "$GUARD_EXE"
sed -i '/^diag_supervisor_diag_path=/d' "$GUARD_MANIFEST"
guard_run
expect_fail_contains "trio guard rejects partial record without diag path" "partial supervisor"
# Truncated proc-stat fields fail closed as unreadable.
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
mkdir -p "$GUARD_PROC/5555"
printf '5555 (sup) S 0 0\n' > "$GUARD_PROC/5555/stat"
rm -f "$GUARD_PROC/5555/exe"; ln -s "$GUARD_EXE" "$GUARD_PROC/5555/exe"
guard_run
expect_fail_contains "trio guard rejects truncated stat fields" "unreadable"
# Bad process state fails closed as unreadable.
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
mkdir -p "$GUARD_PROC/5555"
printf '5555 (sup) ? %s\n' "$(guard_fields 555500 | cut -d' ' -f2-)" > "$GUARD_PROC/5555/stat"
rm -f "$GUARD_PROC/5555/exe"; ln -s "$GUARD_EXE" "$GUARD_PROC/5555/exe"
guard_run
expect_fail_contains "trio guard rejects bad stat state" "unreadable"
# Zero start tick fails closed as unreadable.
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
mkdir -p "$GUARD_PROC/5555"
printf '5555 (sup) %s\n' "$(guard_fields 0)" > "$GUARD_PROC/5555/stat"
rm -f "$GUARD_PROC/5555/exe"; ln -s "$GUARD_EXE" "$GUARD_PROC/5555/exe"
guard_run
expect_fail_contains "trio guard rejects zero stat tick" "unreadable"
# Non-numeric start tick fails closed as unreadable.
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
mkdir -p "$GUARD_PROC/5555"
_GUARD_VALID_TAIL="$(guard_fields 555500)"
printf '5555 (sup) %s abc\n' "${_GUARD_VALID_TAIL% *}" > "$GUARD_PROC/5555/stat"
rm -f "$GUARD_PROC/5555/exe"; ln -s "$GUARD_EXE" "$GUARD_PROC/5555/exe"
guard_run
expect_fail_contains "trio guard rejects non-numeric stat tick" "unreadable"
# Leading PID mismatch fails closed as stale.
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
mkdir -p "$GUARD_PROC/5555"
printf '9999 (sup) %s\n' "$(guard_fields 555500)" > "$GUARD_PROC/5555/stat"
rm -f "$GUARD_PROC/5555/exe"; ln -s "$GUARD_EXE" "$GUARD_PROC/5555/exe"
guard_run
expect_fail_contains "trio guard rejects leading PID mismatch" "stale or unreadable"
# Embedded newline fails closed as unreadable.
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
mkdir -p "$GUARD_PROC/5555"
printf '5555 (sup) %s\nEVIL\n' "$(guard_fields 555500)" > "$GUARD_PROC/5555/stat"
rm -f "$GUARD_PROC/5555/exe"; ln -s "$GUARD_EXE" "$GUARD_PROC/5555/exe"
guard_run
expect_fail_contains "trio guard rejects embedded newline stat" "unreadable"
# Empty stat fails closed as stale/unreadable.
rm -rf "$GUARD_PROC"; mkdir -p "$GUARD_PROC"
guard_write_sup 5555 555500 "$GUARD_EXE"
mkdir -p "$GUARD_PROC/5555"
: > "$GUARD_PROC/5555/stat"
rm -f "$GUARD_PROC/5555/exe"; ln -s "$GUARD_EXE" "$GUARD_PROC/5555/exe"
guard_run
expect_fail_contains "trio guard rejects empty stat" "stale or unreadable"
# Guard performs no shell evaluation or AWK dispatch.
if printf '%s' "$TRIO_GUARD_BODY" | grep -Fq 'eval '; then fail "trio guard contains no eval"; else pass "trio guard contains no eval"; fi
if printf '%s' "$TRIO_GUARD_BODY" | grep -Fq '`'; then fail "trio guard contains no backticks"; else pass "trio guard contains no backticks"; fi
if printf '%s' "$TRIO_GUARD_BODY" | grep -Fq '$AWK_BIN' || printf '%s' "$TRIO_GUARD_BODY" | grep -Fq '"$AWK'; then fail "trio guard dispatches no AWK tool"; else pass "trio guard dispatches no AWK tool"; fi

# 24. verified KWin loadScript contract (static, no transport).
# Success IDs are 0..2147483647; -1 is the failure sentinel; 0 maps
# exactly to /Scripting/Script0; unload authority is the recorded plugin.
LOAD_PRED="$(sed -n "s/^load_valid='\(.*\)'$/\1/p" "$TOOL")"
if [[ -z "$LOAD_PRED" ]]; then fail "load predicate extracts from tool"; else pass "load predicate extracts from tool"; fi
contract_accepts() { printf '%s' "$1" | "$JQ_BIN" -s -e "length == 1 and (.[0] | $LOAD_PRED)" >/dev/null 2>&1; }
contract_rejects() { ! contract_accepts "$1"; }
if contract_accepts '{"type":"i","data":[0]}'; then pass "loadScript 0 accepted (Script0)"; else fail "loadScript 0 accepted (Script0)"; fi
if contract_accepts '{"type":"i","data":[7]}'; then pass "loadScript positive ID accepted"; else fail "loadScript positive ID accepted"; fi
if contract_accepts '{"type":"i","data":[2147483647]}'; then pass "loadScript max ID accepted"; else fail "loadScript max ID accepted"; fi
if contract_rejects '{"type":"i","data":[-1]}'; then pass "loadScript -1 sentinel rejected"; else fail "loadScript -1 sentinel rejected"; fi
for _bad in '{"type":"i","data":[-2]}' '{"type":"i","data":[2147483648]}' '{"type":"i","data":[7.5]}' '{"type":"i","data":["7"]}' '{"type":"i","data":["-1"]}' '{"type":"b","data":[true]}' '{"type":"s","data":["x"]}' '{"type":"u","data":[7]}' '{"type":"i","data":[]}' '{"type":"i","data":[1,2]}' '{"type":"i"}' '{"data":[7]}' '{}'; do
  if contract_rejects "$_bad"; then pass "loadScript malformed rejected: $_bad"; else fail "loadScript malformed rejected: $_bad"; fi
done
if printf '%s\n%s' '{"type":"i","data":[7]}' '{"type":"i","data":[7]}' | "$JQ_BIN" -s -e "length == 1 and (.[0] | $LOAD_PRED)" >/dev/null 2>&1; then fail "loadScript concatenated replies rejected"; else pass "loadScript concatenated replies rejected"; fi
for _pair in "0:/Scripting/Script0" "7:/Scripting/Script7" "2147483647:/Scripting/Script2147483647"; do
  _id="${_pair%%:*}"; _want="${_pair#*:}"
  _got="/Scripting/Script$_id"
  if [[ "$_got" == "$_want" ]]; then pass "Script ID $_id maps exactly $_want"; else fail "Script ID $_id maps exactly $_want"; fi
done
if grep -Fq 'script_obj="/Scripting/Script$SCRIPT_ID"' "$TOOL"; then pass "exact object path uses only the returned ID"; else fail "exact object path uses only the returned ID"; fi
if grep -Fq '/Scripting/Script0' "$TOOL"; then fail "no guessed Script0 literal"; else pass "no guessed Script0 literal"; fi
if grep -Fq 'Scripting.start' "$TOOL"; then fail "no global Scripting.start"; else pass "no global Scripting.start"; fi
if grep -Fq "is already loaded; refusing to load again" "$TOOL" && grep -Fq "already recorded; use cleanup" "$TOOL"; then pass "duplicate object paths rejected (loaded + recorded guards)"; else fail "duplicate object paths rejected (loaded + recorded guards)"; fi
if grep -Fq 'unloadScript s "$PLUGIN"' "$TOOL" && ! grep -Fq 'unloadScript s "$PRODUCTION_PLUGIN"' "$TOOL"; then pass "unload authority is the recorded plugin"; else fail "unload authority is the recorded plugin"; fi
if grep -Fq '"/Scripting/Script$id"' "$TOOL" && grep -Fq 'nested_cleanup_loaded' "$TOOL" && grep -Fq 'partial script-id=$SCRIPT_ID cleanup=' "$TOOL"; then pass "start failure cleanup stops/unloads only the exact recorded plugin/path"; else fail "start failure cleanup stops/unloads only the exact recorded plugin/path"; fi
_L_LOAD="$(grep -n 'loadScript ss' "$TOOL" | head -1 | cut -d: -f1 || true)"
_L_OBJ="$(grep -n 'script_obj="/Scripting/Script$SCRIPT_ID"' "$TOOL" | head -1 | cut -d: -f1 || true)"
_L_RUN="$(grep -n 'BUS_SCRIPT_IFACE run' "$TOOL" | head -1 | cut -d: -f1 || true)"
_L_DONE="$(grep -n 'poc3-id-probe-done:' "$TOOL" | head -1 | cut -d: -f1 || true)"
_L_UNLOAD="$(grep -n 'unloadScript s "$PLUGIN"' "$TOOL" | head -1 | cut -d: -f1 || true)"
if [[ "${_L_LOAD:-0}" -gt 0 && "${_L_OBJ:-0}" -gt "${_L_LOAD:-0}" && "${_L_RUN:-0}" -gt "${_L_OBJ:-0}" && "${_L_DONE:-0}" -gt 0 && "${_L_UNLOAD:-0}" -gt 0 ]]; then pass "Script0 success order is load -> run -> marker -> unload (shape)"; else fail "Script0 success order is load -> run -> marker -> unload (shape)"; fi

# 25. completion hardening: stale nonce boundary plus success/error payload
# distinction (static, no transport). The tool must snapshot a pre-run log
# boundary and scan only post-run bytes, and must validate the success
# payload (exact nonce/owner/generation/revision/three IDs) before record.
if grep -Fq 'probe_detail_is_success' "$TOOL" && grep -Fq 'failed success validation; refusing to record' "$TOOL"; then pass "completion validates success payload before record (shape)"; else fail "completion validates success payload before record (shape)"; fi
if grep -Fq 'probe_log_start' "$TOOL" && grep -Fq '"$STAT_BIN" -c %s' "$TOOL" && grep -Fq 'post_run' "$TOOL"; then pass "completion snapshots pre-run log boundary and scans post-run only (shape)"; else fail "completion snapshots pre-run log boundary and scans post-run only (shape)"; fi
_L_BOUNDARY="$(grep -n 'probe_log_start="$("$STAT_BIN"' "$TOOL" | head -1 | cut -d: -f1 || true)"
_L_PROBE_RUN="$(grep -n 'BUS_SCRIPT_IFACE run' "$TOOL" | head -1 | cut -d: -f1 || true)"
if [[ "${_L_BOUNDARY:-0}" -gt 0 && "${_L_PROBE_RUN:-0}" -gt "${_L_BOUNDARY:-0}" ]]; then pass "log boundary snapshot precedes run invocation (ordering)"; else fail "log boundary snapshot precedes run invocation (ordering)"; fi
if grep -Fq '"$TAIL_BIN" -c "+$((probe_log_start + 1))"' "$TOOL" && grep -Fq '"$TAIL_BIN" -c "$PROBE_LOG_WINDOW_BYTES"' "$TOOL"; then pass "post-run scan stays bounded to 64KiB window plus 1KiB diagnostic (shape)"; else fail "post-run scan stays bounded to 64KiB window plus 1KiB diagnostic (shape)"; fi
if grep -Fq 'has("error") | not' "$TOOL" && grep -Fq '.expected_revision == 0' "$TOOL" && grep -Fq 'length == 3' "$TOOL"; then pass "success predicate rejects error payloads and binds revision plus three IDs (shape)"; else fail "success predicate rejects error payloads and binds revision plus three IDs (shape)"; fi
eval "$(awk '/^probe_detail_is_success\(\)/,/^}/' "$TOOL")"
_DETAIL_OK='plasma-auto-tiler:poc3-id-probe-done:n-1:{"ids":["id-a","id-b","id-c"],"owner":"owner-1","generation":"gen-1","expected_revision":0,"nonce":"n-1"}'
_DETAIL_ERR='plasma-auto-tiler:poc3-id-probe-done:n-1:{"error":"poc3-pid-mismatch"}'
_DETAIL_OWNER='plasma-auto-tiler:poc3-id-probe-done:n-1:{"ids":["id-a","id-b","id-c"],"owner":"evil","generation":"gen-1","expected_revision":0,"nonce":"n-1"}'
_DETAIL_GEN='plasma-auto-tiler:poc3-id-probe-done:n-1:{"ids":["id-a","id-b","id-c"],"owner":"owner-1","generation":"other","expected_revision":0,"nonce":"n-1"}'
_DETAIL_REV='plasma-auto-tiler:poc3-id-probe-done:n-1:{"ids":["id-a","id-b","id-c"],"owner":"owner-1","generation":"gen-1","expected_revision":1,"nonce":"n-1"}'
_DETAIL_TWO='plasma-auto-tiler:poc3-id-probe-done:n-1:{"ids":["id-a","id-b"],"owner":"owner-1","generation":"gen-1","expected_revision":0,"nonce":"n-1"}'
_DETAIL_NONCE='plasma-auto-tiler:poc3-id-probe-done:other:{"ids":["id-a","id-b","id-c"],"owner":"owner-1","generation":"gen-1","expected_revision":0,"nonce":"other"}'
if probe_detail_is_success "$_DETAIL_OK" owner-1 gen-1 n-1; then pass "success payload validates"; else fail "success payload validates"; fi
if probe_detail_is_success "$_DETAIL_ERR" owner-1 gen-1 n-1; then fail "error payload never validates as success"; else pass "error payload never validates as success"; fi
if probe_detail_is_success "$_DETAIL_OWNER" owner-1 gen-1 n-1; then fail "wrong-owner success payload rejected"; else pass "wrong-owner success payload rejected"; fi
if probe_detail_is_success "$_DETAIL_GEN" owner-1 gen-1 n-1; then fail "wrong-generation success payload rejected"; else pass "wrong-generation success payload rejected"; fi
if probe_detail_is_success "$_DETAIL_REV" owner-1 gen-1 n-1; then fail "wrong-revision success payload rejected"; else pass "wrong-revision success payload rejected"; fi
if probe_detail_is_success "$_DETAIL_TWO" owner-1 gen-1 n-1; then fail "two-ID success payload rejected"; else pass "two-ID success payload rejected"; fi
if probe_detail_is_success "$_DETAIL_NONCE" owner-1 gen-1 n-1; then fail "mismatched-nonce success payload rejected"; else pass "mismatched-nonce success payload rejected"; fi
if probe_detail_is_success "" owner-1 gen-1 n-1; then fail "empty detail rejected"; else pass "empty detail rejected"; fi
# Stale nonce boundary (functional, synthetic log only): a reused nonce line
# already in the log must not match once only post-run bytes are examined.
_STALE_LOG="$WORK/stale-private.log"
printf 'plasma-auto-tiler:poc3-id-probe-done:n-1:{"error":"stale"}\n' > "$_STALE_LOG"
_STALE_START="$("$STAT_BIN" -c %s -- "$_STALE_LOG")"
printf 'unrelated noise\n' >> "$_STALE_LOG"
if "$TAIL_BIN" -c "+$((_STALE_START + 1))" -- "$_STALE_LOG" 2>/dev/null | "$GREP_BIN" -F -m 1 -- 'poc3-id-probe-done:n-1' >/dev/null 2>&1; then fail "stale nonce line excluded from post-run slice"; else pass "stale nonce line excluded from post-run slice"; fi
printf '%s\n' "$_DETAIL_OK" >> "$_STALE_LOG"
_STALE_POST="$("$TAIL_BIN" -c "+$((_STALE_START + 1))" -- "$_STALE_LOG" 2>/dev/null | "$TAIL_BIN" -c 65536 2>/dev/null)"
_STALE_DETAIL="$(printf '%s' "$_STALE_POST" | "$GREP_BIN" -F -- 'poc3-id-probe-done:n-1' | "$TAIL_BIN" -n 1 | "$HEAD_BIN" -c 1024)"
if [[ "$_STALE_DETAIL" == *"stale"* ]]; then fail "post-run slice prefers fresh completion over stale line"; else pass "post-run slice prefers fresh completion over stale line"; fi
if probe_detail_is_success "$_STALE_DETAIL" owner-1 gen-1 n-1; then pass "fresh post-run success validates after stale line"; else fail "fresh post-run success validates after stale line"; fi
_STALE_ONLY="$(printf 'plasma-auto-tiler:poc3-id-probe-done:n-1:{"error":"stale"}\n' | "$HEAD_BIN" -c 1024)"
if probe_detail_is_success "$_STALE_ONLY" owner-1 gen-1 n-1; then fail "stale error line never validates as success"; else pass "stale error line never validates as success"; fi
rm -f "$_STALE_LOG"

printf 'poc3-id-probe static: pass=%s fail=%s\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
