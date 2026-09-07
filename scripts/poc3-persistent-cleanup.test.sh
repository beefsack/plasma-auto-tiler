#!/usr/bin/env bash
# Static tests for persistent POC3 adapter cleanup (exact, manifest-bound).
#
# No live execution: never runs busctl transport, dbus-run-session, nested
# KWin, GUI clients, or host KWin. All PID/proc/bus inputs are synthetic
# fixtures; every persistent-cleanup invocation fails closed before any
# transport. Ordering/authority properties are asserted statically on the
# cleanup function body.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TOOL="$REPO_ROOT/scripts/poc3-command.sh"
WORK="$(mktemp -d)"
OUTPUT="$(mktemp)"
PASS=0
FAIL=0

cleanup() {
  rm -rf "$WORK"
  rm -f "$OUTPUT"
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

add_persistent_enroll() {
  local wd="$1" sid="${2:-0}"
  cat >> "$wd/manifest" <<EOF
persistent_plugin=poc3-persistent-adapter
persistent_script_id=$sid
persistent_owner=owner-1
persistent_generation=gen-1
persistent_nonce=n-1
persistent_pids=4441,4442,4443
EOF
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

run_cleanup() {
  local wd="$1"
  shift
  set +e
  PROC_ROOT="$WORK/proc" STAT_BIN="$STAT_BIN" SHA256SUM_BIN="$SHA_BIN" \
    KWIN_EXPECTED_VERSION=6.7.4 DBUS_SESSION_BUS_ADDRESS="unix:path=$WORK/host-runtime/bus" \
    POC3_NESTED_ALLOW=1 NESTED_KWIN_TEST_ALLOW_NONSTORE=1 \
    "$BASH_BIN" "$TOOL" nested "$wd" persistent-cleanup "$@" >"$OUTPUT" 2>&1
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

expect_fail_absent() {
  local name="$1" needle="$2"
  if [[ "$VALID_EXIT" -ne 0 ]] && ! grep -Fq "$needle" "$OUTPUT"; then
    PASS=$((PASS + 1))
    printf 'pass: %s\n' "$name"
  else
    printf 'FAIL: %s (expected failure without "%s", exit %s)\n' "$name" "$needle" "$VALID_EXIT" >&2
    cat "$OUTPUT" >&2
    FAIL=$((FAIL + 1))
  fi
}

shape_pass() {
  local name="$1"
  PASS=$((PASS + 1))
  printf 'pass: %s\n' "$name"
}

shape_fail() {
  local name="$1"
  printf 'FAIL: %s\n' "$name" >&2
  FAIL=$((FAIL + 1))
}

setup_fixtures

# 1. syntax
if "$BASH_BIN" -n "$TOOL"; then PASS=$((PASS + 1)); printf 'pass: bash -n syntax\n'; else printf 'FAIL: bash -n syntax\n' >&2; FAIL=$((FAIL + 1)); fi

CLEANUP_BODY="$(awk '/^nested_cmd_persistent_cleanup\(\)/,/^}/' "$TOOL")"

# 2. caller-supplied ID is rejected (no args accepted)
reset_fixtures
write_valid_manifest "$WORK/case/args"
add_persistent_enroll "$WORK/case/args"
add_trio "$WORK/case/args"
run_cleanup "$WORK/case/args" 0
expect_fail_contains "extra arg rejected (no caller-supplied ID)" "takes no arguments"

# 3. absent persistent record fails closed
reset_fixtures
write_valid_manifest "$WORK/case/absent"
add_trio "$WORK/case/absent"
run_cleanup "$WORK/case/absent"
expect_fail_contains "absent enroll record fails closed" "no retained persistent enroll identity"

# 4. partial association (missing owner) fails closed
reset_fixtures
write_valid_manifest "$WORK/case/partial"
add_persistent_enroll "$WORK/case/partial"
add_trio "$WORK/case/partial"
sed -i '/^persistent_owner=/d' "$WORK/case/partial/manifest"
run_cleanup "$WORK/case/partial"
expect_fail_contains "partial association fails closed" "partial"

# 5. plugin mismatch fails closed
reset_fixtures
write_valid_manifest "$WORK/case/plugin"
add_persistent_enroll "$WORK/case/plugin"
add_trio "$WORK/case/plugin"
sed -i 's|^persistent_plugin=.*|persistent_plugin=poc3-manual-command|' "$WORK/case/plugin/manifest"
run_cleanup "$WORK/case/plugin"
expect_fail_contains "plugin mismatch fails closed" "does not match"

# 6. invalid script id fails closed
reset_fixtures
write_valid_manifest "$WORK/case/badsid"
add_persistent_enroll "$WORK/case/badsid" 99999999999
add_trio "$WORK/case/badsid"
run_cleanup "$WORK/case/badsid"
expect_fail_contains "invalid script id fails closed" "script id is invalid"

# 7. disposable mix refused (trio-only close): full disposable group keeps the
# manifest valid so the trio-binding gate is the authority that refuses.
reset_fixtures
write_valid_manifest "$WORK/case/mix"
add_persistent_enroll "$WORK/case/mix"
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
run_cleanup "$WORK/case/mix"
expect_fail_contains "disposable mix refused" "diagnostic trio"

# 8. non-diagnostic trio refused
reset_fixtures
write_valid_manifest "$WORK/case/nondiag"
add_persistent_enroll "$WORK/case/nondiag"
add_trio "$WORK/case/nondiag"
sed -i "s|manual_1_bin=$|manual_1_bin=/bin/sleep|" "$WORK/case/nondiag/manifest"
sed -i "s|^manual_1_bin=.*|manual_1_bin=/bin/sleep|" "$WORK/case/nondiag/manifest"
run_cleanup "$WORK/case/nondiag"
expect_fail_contains "non-diagnostic trio refused" "diagnostic client"

# 9. stale PID association refused (enroll pids vs current manuals)
reset_fixtures
write_valid_manifest "$WORK/case/stale"
add_persistent_enroll "$WORK/case/stale"
add_trio "$WORK/case/stale"
sed -i 's|^persistent_pids=.*|persistent_pids=4441,4442,9999|' "$WORK/case/stale/manifest"
run_cleanup "$WORK/case/stale"
expect_fail_contains "stale pid association refused" "changed since enroll"

# 10. stale start-tick refused (PID reuse fail-closed)
reset_fixtures
write_valid_manifest "$WORK/case/tick"
add_persistent_enroll "$WORK/case/tick"
add_trio "$WORK/case/tick"
proc_fixture 4441 999999 "$(readlink -f -- "$FAKE_DIAG")"
run_cleanup "$WORK/case/tick"
expect_fail_contains "stale start-tick refused" "start-tick mismatch"

# 11. Script0 passes ID validation (fails later at bus scope, never at ID check)
reset_fixtures
write_valid_manifest "$WORK/case/script0"
add_persistent_enroll "$WORK/case/script0" 0
add_trio "$WORK/case/script0"
run_cleanup "$WORK/case/script0"
expect_fail_absent "Script0 passes ID validation" "script id is invalid"

# 12. no log-marker authority in cleanup body
if grep -Fq "poc3-command-done" <<<"$CLEANUP_BODY"; then shape_fail "cleanup has no log completion marker authority"; else shape_pass "cleanup has no log completion marker authority"; fi
if grep -Fq 'tail -n' <<<"$CLEANUP_BODY"; then shape_fail "cleanup reads no private log tail"; else shape_pass "cleanup reads no private log tail"; fi

# 13. no guessed Script0 and no caller-supplied ID in cleanup body
if grep -Fq 'Script0' <<<"$CLEANUP_BODY"; then shape_fail "cleanup has no guessed Script0"; else shape_pass "cleanup has no guessed Script0"; fi
if grep -Fq '[[ $# -eq 0 ]]' <<<"$CLEANUP_BODY"; then shape_pass "cleanup takes no caller ID"; else shape_fail "cleanup takes no caller ID"; fi

# 14. Script0 valid: non-negative 32-bit range without a positive-only guard
if grep -Fq '^[0-9]+$' <<<"$CLEANUP_BODY"; then shape_pass "cleanup allows Script0 range"; else shape_fail "cleanup allows Script0 range"; fi
if grep -Eq -- '-gt 0|-ge 1' <<<"$CLEANUP_BODY"; then shape_fail "cleanup has no positive-only script guard"; else shape_pass "cleanup has no positive-only script guard"; fi

# 15. exact unload is ordered before trio close with unload result recorded first
UNLOAD_LINE="$(grep -n 'persistent_exact_unload "$script_id"' <<<"$CLEANUP_BODY" | head -n 1 | cut -d: -f1)"
RECORDED_LINE="$(grep -n 'enroll-cleanup: unloaded' <<<"$CLEANUP_BODY" | head -n 1 | cut -d: -f1)"
TRIO_LINE="$(grep -n 'NESTED_MANUAL_CLIENTS_SH' <<<"$CLEANUP_BODY" | tail -n 1 | cut -d: -f1)"
if [[ -n "$UNLOAD_LINE" && -n "$RECORDED_LINE" && -n "$TRIO_LINE" && "$UNLOAD_LINE" -lt "$RECORDED_LINE" && "$RECORDED_LINE" -lt "$TRIO_LINE" ]]; then
  shape_pass "unload then unload-result then trio close ordering"
else
  shape_fail "unload then unload-result then trio close ordering"
fi

# 16. pre-mutation validation: manifest, trio binding, KWin/bus scope
if grep -Fq 'persistent_validate_trio_binding' <<<"$CLEANUP_BODY" && grep -Fq 'nested_find_kwin_pid' <<<"$CLEANUP_BODY" && grep -Fq 'nested_refuse_when_production_loaded' <<<"$CLEANUP_BODY"; then
  shape_pass "cleanup validates trio binding and KWin scope before mutation"
else
  shape_fail "cleanup validates trio binding and KWin scope before mutation"
fi
if grep -Fq 'persistent_owner' <<<"$CLEANUP_BODY" && grep -Fq 'persistent_generation' <<<"$CLEANUP_BODY" && grep -Fq 'persistent_nonce' <<<"$CLEANUP_BODY"; then
  shape_pass "cleanup validates owner/generation/nonce association"
else
  shape_fail "cleanup validates owner/generation/nonce association"
fi

# 17. exact object proof before unload (introspect plus Script iface predicate)
UNLOAD_BODY="$(awk '/^persistent_exact_unload\(\)/,/^}/' "$TOOL")"
if grep -Fq 'introspect' <<<"$UNLOAD_BODY" && grep -Fq 'script_iface_valid' <<<"$UNLOAD_BODY"; then
  shape_pass "exact unload requires Script object proof"
else
  shape_fail "exact unload requires Script object proof"
fi

# 18. enroll records the full association for later cleanup
ENROLL_BODY="$(awk '/^persistent_record_success\(\)/,/^}/' "$TOOL")"
if grep -Fq 'persistent_owner=' <<<"$ENROLL_BODY" && grep -Fq 'persistent_generation=' <<<"$ENROLL_BODY" && grep -Fq 'persistent_nonce=' <<<"$ENROLL_BODY" && grep -Fq 'persistent_pids=' <<<"$ENROLL_BODY"; then
  shape_pass "enroll records owner/generation/nonce/pids association"
else
  shape_fail "enroll records owner/generation/nonce/pids association"
fi

# 19. cleanup uses the private bus scope only (no host scope, no journal;
# transport flows through the manifest-bound private-state and KWin-scope
# helpers, never a host session bus or journal cursor)
if grep -Fq -- '--user' <<<"$CLEANUP_BODY"; then shape_fail "cleanup has no host bus scope"; else shape_pass "cleanup has no host bus scope"; fi
if grep -Fq 'journalctl' <<<"$CLEANUP_BODY"; then shape_fail "cleanup has no journal authority"; else shape_pass "cleanup has no journal authority"; fi
if grep -Fq 'nested_load_private_state' <<<"$CLEANUP_BODY" && grep -Fq 'nested_find_kwin_pid' <<<"$CLEANUP_BODY"; then shape_pass "cleanup uses manifest-bound bus scope"; else shape_fail "cleanup uses manifest-bound bus scope"; fi

# 20. record retained until trio verifies; retry never unloads twice
if grep -Fq 'persistent_mark_unload_verified' <<<"$CLEANUP_BODY" && grep -Fq 'persistent_unload_verified=1' <<<"$CLEANUP_BODY"; then
  shape_pass "cleanup marks unload verified without clearing record"
else
  shape_fail "cleanup marks unload verified without clearing record"
fi
CLEAR_LINE="$(grep -n 'persistent_clear_record' <<<"$CLEANUP_BODY" | head -n 1 | cut -d: -f1)"
if [[ -n "$CLEAR_LINE" && -n "$TRIO_LINE" && "$TRIO_LINE" -lt "$CLEAR_LINE" ]]; then
  shape_pass "record cleared only after trio verifies"
else
  shape_fail "record cleared only after trio verifies"
fi
if grep -Fq 'unload already verified' <<<"$CLEANUP_BODY" && grep -Fq 'unload verified trio pending' <<<"$CLEANUP_BODY"; then
  shape_pass "retry skips second unload and reports unload verified/trio pending"
else
  shape_fail "retry skips second unload and reports unload verified/trio pending"
fi

# 21. weak plugin identity is not overstated (no plugin id on ScriptN)
if grep -Fq 'exposes no plugin identity' "$TOOL"; then
  shape_pass "cleanup documents ScriptN plugin-identity limitation"
else
  shape_fail "cleanup documents ScriptN plugin-identity limitation"
fi

printf 'poc3-persistent-cleanup static: pass=%s fail=%s\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
