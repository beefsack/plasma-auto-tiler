#!/usr/bin/env bash
# Static + synthetic tests for the persistent POC3 direct-enrollment start
# pivot (generated bundle evidence, Script-ID recording, stays-loaded,
# exact cleanup binding, no external IDs, no ID probe, no production coupling).
#
# No live execution: never runs busctl transport, dbus-run-session, nested
# KWin, GUI clients, or host KWin. All PID/proc/bus inputs are synthetic
# fixtures; every enroll-start invocation fails closed before any transport.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TOOL="$REPO_ROOT/scripts/poc3-command.sh"
HELPER="$REPO_ROOT/scripts/poc3-build-persistent-adapter.mjs"
BUNDLE="$REPO_ROOT/kwin/dist/poc3-persistent-adapter.js"
WORK="$(mktemp -d)"
OUTPUT="$(mktemp)"
PASS=0
FAIL=0

cleanup() {
  rm -rf "$WORK"
  rm -f "$OUTPUT"
  rm -f "$BUNDLE"
}
trap cleanup EXIT

BASH_BIN="$(command -v bash)"
STAT_BIN="$(command -v stat)"
SHA_BIN="$(command -v sha256sum)"
FAKE_KWIN_674="$WORK/kwin-6.7.4/bin/kwin_wayland"
FAKE_DIAG="$WORK/bin/poc3-diagnostic-client"

setup_fixtures() {
  mkdir -p "$WORK/kwin-6.7.4/bin" "$WORK/bin"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_KWIN_674"
  chmod +x "$FAKE_KWIN_674"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_DIAG"
  chmod +x "$FAKE_DIAG"
  printf 'kwinrc-fixture\n' > "$WORK/fake-kwinrc"
}

proc_fixture() {
  local pid="$1" tick="$2" exe="$3"
  local dir="$WORK/proc/$pid"
  mkdir -p "$dir"
  local fields="S"
  local k
  for ((k = 1; k < 19; k += 1)); do fields+=' 0'; done
  fields+=" $tick"
  printf '%s (fixture) %s\n' "$pid" "$fields" > "$dir/stat"
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

add_trio() {
  local wd="$1"
  local canon argv
  canon="$(readlink -f -- "$FAKE_DIAG")"
  argv="$(printf '%s\0' "$canon" "--runtime" "x" | sha256sum | awk '{print $1}')"
  cat >> "$wd/manifest" <<EOF
manual_count=3
manual_1_pid=4441
manual_1_starttick=444100
manual_1_exe=$canon
manual_1_bin=$canon
manual_1_bin_canonical=$canon
manual_1_argc=9
manual_1_argv_sha256=$argv
manual_1_diag_path=$wd/manual-1.diag.log
manual_2_pid=4442
manual_2_starttick=444200
manual_2_exe=$canon
manual_2_bin=$canon
manual_2_bin_canonical=$canon
manual_2_argc=9
manual_2_argv_sha256=$argv
manual_2_diag_path=$wd/manual-2.diag.log
manual_3_pid=4443
manual_3_starttick=444300
manual_3_exe=$canon
manual_3_bin=$canon
manual_3_bin_canonical=$canon
manual_3_argc=9
manual_3_argv_sha256=$argv
manual_3_diag_path=$wd/manual-3.diag.log
EOF
}

reset_fixtures() {
  rm -rf "$WORK/proc" "$WORK/host-runtime" "$WORK/case"
  mkdir -p "$WORK/proc" "$WORK/host-runtime" "$WORK/case"
  rm -f "$WORK/host-runtime/wayland-0"
  python3 -c "import socket; s=socket.socket(socket.AF_UNIX); s.bind('$WORK/host-runtime/wayland-0')" 2>/dev/null || : > "$WORK/host-runtime/wayland-0"
  proc_fixture 2222 222200 "$FAKE_KWIN_674"
  proc_fixture 3333 333300 /fake/dbus-supervisor
  proc_fixture 4441 444100 "$(readlink -f -- "$FAKE_DIAG")"
  proc_fixture 4442 444200 "$(readlink -f -- "$FAKE_DIAG")"
  proc_fixture 4443 444300 "$(readlink -f -- "$FAKE_DIAG")"
}

run_start() {
  local wd="$1"
  shift
  set +e
  PROC_ROOT="$WORK/proc" STAT_BIN="$STAT_BIN" SHA256SUM_BIN="$SHA_BIN" \
    KWIN_EXPECTED_VERSION=6.7.4 DBUS_SESSION_BUS_ADDRESS="unix:path=$WORK/host-runtime/bus" \
    POC3_NESTED_ALLOW=1 NESTED_KWIN_TEST_ALLOW_NONSTORE=1 \
    "$BASH_BIN" "$TOOL" nested "$wd" start --owner owner-1 --generation gen-1 --nonce n-1 "$@" >"$OUTPUT" 2>&1
  VALID_EXIT=$?
  set -e
}

expect_fail_contains() {
  local name="$1" needle="$2"
  if [[ "$VALID_EXIT" -ne 0 ]] && grep -Fq "$needle" "$OUTPUT"; then
    PASS=$((PASS + 1)); printf 'pass: %s\n' "$name"
  else
    printf 'FAIL: %s (expected failure containing "%s", exit %s)\n' "$name" "$needle" "$VALID_EXIT" >&2
    cat "$OUTPUT" >&2; FAIL=$((FAIL + 1))
  fi
}

shape_pass() { PASS=$((PASS + 1)); printf 'pass: %s\n' "$1"; }
shape_fail() { printf 'FAIL: %s\n' "$1" >&2; FAIL=$((FAIL + 1)); }

setup_fixtures

if "$BASH_BIN" -n "$TOOL"; then PASS=$((PASS + 1)); printf 'pass: bash -n syntax\n'; else printf 'FAIL: bash -n syntax\n' >&2; FAIL=$((FAIL + 1)); fi
if node --check "$HELPER"; then PASS=$((PASS + 1)); printf 'pass: node --check persistent builder\n'; else printf 'FAIL: node --check persistent builder\n' >&2; FAIL=$((FAIL + 1)); fi

START_BODY="$(awk '/^nested_cmd_persistent_start\(\)/,/^}/' "$TOOL")"

# 1. external native IDs rejected (no caller IDs on direct route)
reset_fixtures
write_valid_manifest "$WORK/case/ids"
add_trio "$WORK/case/ids"
run_start "$WORK/case/ids" id-a id-b id-c
expect_fail_contains "external native IDs rejected" "takes no window IDs"

# 2. unknown flags rejected (initial-start-only surface)
reset_fixtures
write_valid_manifest "$WORK/case/flag"
add_trio "$WORK/case/flag"
run_start "$WORK/case/flag" --revision 1
expect_fail_contains "unknown enroll flag rejected" "unknown enroll-start flag"

# 3. missing trio fails closed before planner call
reset_fixtures
write_valid_manifest "$WORK/case/missing"
run_start "$WORK/case/missing"
expect_fail_contains "missing trio fails closed" "manual group is not ready"

# 4. shared PID fails closed
reset_fixtures
write_valid_manifest "$WORK/case/shared"
add_trio "$WORK/case/shared"
sed -i 's|^manual_2_pid=.*|manual_2_pid=4441|' "$WORK/case/shared/manifest"
run_start "$WORK/case/shared"
expect_fail_contains "shared PID fails closed" "not distinct"

# 5. missing tick fails closed
reset_fixtures
write_valid_manifest "$WORK/case/notick"
add_trio "$WORK/case/notick"
sed -i '/^manual_2_starttick=/d' "$WORK/case/notick/manifest"
run_start "$WORK/case/notick"
expect_fail_contains "missing tick fails closed" "starttick"

# 6. tick mismatch (PID reuse) fails closed
reset_fixtures
write_valid_manifest "$WORK/case/reuse"
add_trio "$WORK/case/reuse"
proc_fixture 4441 999999 "$(readlink -f -- "$FAKE_DIAG")"
run_start "$WORK/case/reuse"
expect_fail_contains "tick mismatch fails closed" "start-tick mismatch"

# 7. non-diagnostic slot fails closed
reset_fixtures
write_valid_manifest "$WORK/case/nondiag"
add_trio "$WORK/case/nondiag"
sed -i "s|^manual_1_bin=.*|manual_1_bin=/bin/sleep|" "$WORK/case/nondiag/manifest"
run_start "$WORK/case/nondiag"
expect_fail_contains "non-diagnostic slot fails closed" "diagnostic client"

# 8. disposable mix fails closed
reset_fixtures
write_valid_manifest "$WORK/case/mix"
add_trio "$WORK/case/mix"
mkdir -p "$WORK/weston-bin"
printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/weston-bin/weston-terminal"
chmod +x "$WORK/weston-bin/weston-terminal"
MIX_CANON="$(readlink -f -- "$WORK/weston-bin/weston-terminal")"
MIX_SHA="$(sha256sum -- "$MIX_CANON" | awk '{print $1}')"
MIX_DEVINO="$("$STAT_BIN" -c '%d:%i' -- "$MIX_CANON")"
cat >> "$WORK/case/mix/manifest" <<EOF
client_count=3
client_bin=$MIX_CANON
client_bin_canonical=$MIX_CANON
client_bin_sha256=$MIX_SHA
client_bin_dev=${MIX_DEVINO%%:*}
client_bin_ino=${MIX_DEVINO##*:}
client_1_pid=5551
client_1_starttick=555100
client_1_exe=$MIX_CANON
client_2_pid=5552
client_2_starttick=555200
client_2_exe=$MIX_CANON
client_3_pid=5553
client_3_starttick=555300
client_3_exe=$MIX_CANON
EOF
run_start "$WORK/case/mix"
expect_fail_contains "disposable mix fails closed" "refuses to mix modes"

# 9. builder embeds full evidence from manifest (synthetic build)
BUS_ADDR="unix:path=$WORK/case/ev/runtime/bus"
reset_fixtures
write_valid_manifest "$WORK/case/ev"
add_trio "$WORK/case/ev"
if node "$HELPER" --owner owner-1 --generation gen-1 --nonce n-1 \
  --expected-pids 4441,4442,4443 --expected-ticks 444100,444200,444300 \
  --expected-app-ids org.plasma-auto-tiler.poc3-diag-1,org.plasma-auto-tiler.poc3-diag-2,org.plasma-auto-tiler.poc3-diag-3 \
  --expected-slots 1,2,3 --expected-colors ffc02020,ff20a020,ff2040c0 \
  --planner-owner owner-1 --planner-unique-owner ":1.42" --planner-bus "$BUS_ADDR" \
  --out "$BUNDLE" >"$OUTPUT" 2>&1; then
  if grep -Fq "4441" "$BUNDLE" && grep -Fq "444100" "$BUNDLE" && grep -Fq "org.plasma-auto-tiler.poc3-diag-1" "$BUNDLE" && grep -Fq "ffc02020" "$BUNDLE" && grep -Fq "owner-1" "$BUNDLE" && grep -Fq ":1.42" "$BUNDLE" && grep -Fq "EvaluatePoc3" "$BUNDLE"; then
    shape_pass "builder embeds PID+tick+app_id+slot+color+owner+planner evidence"
  else
    shape_fail "builder embeds PID+tick+app_id+slot+color+owner+planner evidence"
  fi
else
  shape_fail "builder embeds PID+tick+app_id+slot+color+owner+planner evidence"
fi
rm -f "$BUNDLE"

# 10. builder rejects malformed/mismatched/missing/shared evidence
reject_case() {
  local name="$1"; shift
  if node "$HELPER" "$@" --out "$BUNDLE" >"$OUTPUT" 2>&1; then
    shape_fail "$name"
  else
    shape_pass "$name"
  fi
  rm -f "$BUNDLE"
}
reject_case "builder rejects PIDs alone (missing full evidence)" \
  --owner owner-1 --generation gen-1 --nonce n-1 --expected-pids 4441,4442,4443
reject_case "builder rejects shared PIDs" \
  --owner owner-1 --generation gen-1 --nonce n-1 --expected-pids 4441,4441,4442 \
  --expected-ticks 444100,444200,444300 \
  --expected-app-ids org.plasma-auto-tiler.poc3-diag-1,org.plasma-auto-tiler.poc3-diag-2,org.plasma-auto-tiler.poc3-diag-3 \
  --expected-slots 1,2,3 --expected-colors ffc02020,ff20a020,ff2040c0 \
  --planner-owner owner-1 --planner-unique-owner ":1.42" --planner-bus "$BUS_ADDR"
reject_case "builder rejects swapped app_ids" \
  --owner owner-1 --generation gen-1 --nonce n-1 --expected-pids 4441,4442,4443 \
  --expected-ticks 444100,444200,444300 \
  --expected-app-ids org.plasma-auto-tiler.poc3-diag-2,org.plasma-auto-tiler.poc3-diag-1,org.plasma-auto-tiler.poc3-diag-3 \
  --expected-slots 1,2,3 --expected-colors ffc02020,ff20a020,ff2040c0 \
  --planner-owner owner-1 --planner-unique-owner ":1.42" --planner-bus "$BUS_ADDR"
reject_case "builder rejects planner-owner mismatch" \
  --owner owner-1 --generation gen-1 --nonce n-1 --expected-pids 4441,4442,4443 \
  --expected-ticks 444100,444200,444300 \
  --expected-app-ids org.plasma-auto-tiler.poc3-diag-1,org.plasma-auto-tiler.poc3-diag-2,org.plasma-auto-tiler.poc3-diag-3 \
  --expected-slots 1,2,3 --expected-colors ffc02020,ff20a020,ff2040c0 \
  --planner-owner owner-2 --planner-unique-owner ":1.42" --planner-bus "$BUS_ADDR"
reject_case "builder rejects non-unix planner bus" \
  --owner owner-1 --generation gen-1 --nonce n-1 --expected-pids 4441,4442,4443 \
  --expected-ticks 444100,444200,444300 \
  --expected-app-ids org.plasma-auto-tiler.poc3-diag-1,org.plasma-auto-tiler.poc3-diag-2,org.plasma-auto-tiler.poc3-diag-3 \
  --expected-slots 1,2,3 --expected-colors ffc02020,ff20a020,ff2040c0 \
  --planner-owner owner-1 --planner-unique-owner ":1.42" --planner-bus "tcp:host=x"
reject_case "builder rejects missing planner unique owner" \
  --owner owner-1 --generation gen-1 --nonce n-1 --expected-pids 4441,4442,4443 \
  --expected-ticks 444100,444200,444300 \
  --expected-app-ids org.plasma-auto-tiler.poc3-diag-1,org.plasma-auto-tiler.poc3-diag-2,org.plasma-auto-tiler.poc3-diag-3 \
  --expected-slots 1,2,3 --expected-colors ffc02020,ff20a020,ff2040c0 \
  --planner-owner owner-1 --planner-bus "$BUS_ADDR"
reject_case "builder rejects malformed planner unique owner" \
  --owner owner-1 --generation gen-1 --nonce n-1 --expected-pids 4441,4442,4443 \
  --expected-ticks 444100,444200,444300 \
  --expected-app-ids org.plasma-auto-tiler.poc3-diag-1,org.plasma-auto-tiler.poc3-diag-2,org.plasma-auto-tiler.poc3-diag-3 \
  --expected-slots 1,2,3 --expected-colors ffc02020,ff20a020,ff2040c0 \
  --planner-owner owner-1 --planner-unique-owner "org.plasmaautotiler.Planner" --planner-bus "$BUS_ADDR"

# 11. shell passes full evidence to the builder (not PIDs alone)
if grep -Fq -- "--expected-ticks" <<<"$START_BODY" && grep -Fq -- "--expected-app-ids" <<<"$START_BODY" && grep -Fq -- "--expected-slots" <<<"$START_BODY" && grep -Fq -- "--expected-colors" <<<"$START_BODY" && grep -Fq -- "--planner-owner" <<<"$START_BODY" && grep -Fq -- "--planner-unique-owner" <<<"$START_BODY" && grep -Fq -- "--planner-bus" <<<"$START_BODY"; then
  shape_pass "shell propagates PID+tick+app_id+slot+color+planner evidence to builder"
else
  shape_fail "shell propagates PID+tick+app_id+slot+color+planner evidence to builder"
fi
if grep -Fq "persistent_validate_trio_binding" <<<"$START_BODY" && grep -Fq "persistent_load_manual_ticks" <<<"$START_BODY" && grep -Fq "persistent_planner_unique_owner" <<<"$START_BODY"; then
  shape_pass "shell validates full trio binding plus unique owner before planner call"
else
  shape_fail "shell validates full trio binding plus unique owner before planner call"
fi
if grep -Fq -- "--usable is rejected" "$TOOL"; then
  shape_pass "direct start rejects operator usable (derived from output)"
else
  shape_fail "direct start rejects operator usable (derived from output)"
fi
if grep -Fq 'persistent_planner_status_inner "$PLANNER_UNIQUE"' "$TOOL"; then
  shape_pass "planner status targets the exact unique owner"
else
  shape_fail "planner status targets the exact unique owner"
fi

# 12. Script ID recorded immediately including 0; stays loaded on success and failure
if grep -Fq 'SCRIPT_ID="$(jq -r' <<<"$START_BODY"; then shape_pass "start records returned Script ID immediately"; else shape_fail "start records returned Script ID immediately"; fi
LOAD_PRED="$(sed -n "s/^load_valid='\(.*\)'$/\1/p" "$TOOL")"
if printf '%s' '{"type":"i","data":[0]}' | jq -s -e "length == 1 and (.[0] | $LOAD_PRED)" >/dev/null 2>&1; then
  shape_pass "Script 0 is a valid recorded ID (Script0)"
else
  shape_fail "Script 0 is a valid recorded ID (Script0)"
fi
if grep -Fq "stays-loaded (use persistent-cleanup" <<<"$START_BODY"; then shape_pass "stays loaded on success and failure"; else shape_fail "stays loaded on success and failure"; fi
if grep -Fq 'persistent_exact_unload "$SCRIPT_ID"' <<<"$START_BODY"; then shape_pass "failure path unloads only the exact recorded ID"; else shape_fail "failure path unloads only the exact recorded ID"; fi

# 13. cleanup unloads exactly recorded plugin/id without a marker, closes only manifest-bound diagnostics
CLEANUP_BODY="$(awk '/^nested_cmd_persistent_cleanup\(\)/,/^}/' "$TOOL")"
if grep -Fq 'persistent_exact_unload "$script_id"' <<<"$CLEANUP_BODY"; then shape_pass "cleanup unloads exactly recorded plugin/id"; else shape_fail "cleanup unloads exactly recorded plugin/id"; fi
if grep -Fq "poc3-command-done" <<<"$CLEANUP_BODY"; then shape_fail "cleanup has no log-marker authority"; else shape_pass "cleanup has no log-marker authority"; fi
if grep -Fq 'NESTED_MANUAL_CLIENTS_SH' <<<"$CLEANUP_BODY" && grep -Fq 'persistent_validate_trio_binding' <<<"$CLEANUP_BODY"; then
  shape_pass "cleanup closes only manifest-bound diagnostics"
else
  shape_fail "cleanup closes only manifest-bound diagnostics"
fi

# 14. direct start never runs the old ID probe
if grep -Fq "poc3-build-id-probe" <<<"$START_BODY" || grep -Fq "poc3-id-probe" <<<"$START_BODY" || grep -Fq "evaluateIdProbe" <<<"$START_BODY"; then
  shape_fail "direct start never runs the old ID probe"
else
  shape_pass "direct start never runs the old ID probe"
fi
if grep -Fq "takes no window IDs" "$TOOL" && grep -Fq 'takes no arguments' "$TOOL"; then
  shape_pass "direct start/cleanup accept no external native-ID arguments"
else
  shape_fail "direct start/cleanup accept no external native-ID arguments"
fi

# 15. no production coupling; legacy routes preserved with initial-start-only limit
if grep -Fq "nested_refuse_when_production_loaded" <<<"$START_BODY" && grep -Fq 'PRODUCTION_PLUGIN="plasma-auto-tiler-kwin"' "$TOOL"; then shape_pass "production coexistence guard preserved"; else shape_fail "production coexistence guard preserved"; fi
for bad in "CustomTile" "custom-tile" "registerShortcut" "setShortcutKeys" "kpackagetool" "tray" "KCM" "kcm" "autostart" "contents/code/main" "readConfig"; do
  if grep -Fq "$bad" <<<"$START_BODY"; then shape_fail "no production coupling ($bad)"; else shape_pass "no production coupling ($bad)"; fi
done
if grep -Fq "persistent direct-enrollment supports initial start only" "$TOOL" && grep -Fq "parse_command_args" "$TOOL"; then
  shape_pass "legacy routes preserved with initial-start-only limit"
else
  shape_fail "legacy routes preserved with initial-start-only limit"
fi

printf 'poc3-persistent-start static: pass=%s fail=%s\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
