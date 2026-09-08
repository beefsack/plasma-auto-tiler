#!/usr/bin/env bash
# Focused hermetic coverage for poc3_kwin_direct_parent_fallback.
#
# No live execution: never touches host D-Bus, systemctl --user, or real
# /proc. All inputs are synthetic fixtures under a temp dir (fake systemctl
# shim, fake PROC_ROOT, fixture store files). Tests actual helper behavior
# via exit codes and 18-line identity output, not mere string presence.
# D-Bus owner/PID/tick are caller-pinned inputs to the helper, so owner/PID
# drift is proven via receipt capture/revalidation (first 3 receipt lines)
# plus live tick/PPid re-pin behavior; no busctl fixture applies to this
# helper. Production parsers are not duplicated: revalidation uses
# whole-output diff, never a reimplemented ExecStart parser.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TOOL="$REPO_ROOT/scripts/poc3-host-kwin-identity.sh"
WORK="$(mktemp -d)"
OUTPUT="$(mktemp)"
FRESH="$(mktemp)"
REV="$(mktemp)"
PASS=0
FAIL=0

cleanup() {
  rm -rf "$WORK"
  rm -f "$OUTPUT" "$FRESH" "$REV" "$FRESH.expected"
}
trap cleanup EXIT

BASH_BIN="$(command -v bash)"
PKG_ROOT="$WORK/pkg"
LAUNCHER="$PKG_ROOT/bin/kwin_wayland_wrapper"
WRAPPED="$PKG_ROOT/bin/.kwin_wayland_wrapper-wrapped"
STORE_FILE="$WRAPPED"
OTHER_FILE="$WORK/pkg/bin/other_bin"
OTHER_PKG_ROOT="$WORK/pkg2"
OTHER_LAUNCHER="$OTHER_PKG_ROOT/bin/kwin_wayland_wrapper"
OTHER_WRAPPED="$OTHER_PKG_ROOT/bin/.kwin_wayland_wrapper-wrapped"
MAIN_PID="2000"
MAIN_TICK="200000"
OWNER_PID="2001"
OWNER_TICK="200100"
INTERMEDIATE_PID="2002"
INTERMEDIATE_TICK="200200"
PROC_OWNER=":1.10"
BOOT_ID="12345678-1234-1234-1234-123456789abc"
BOOT_ID2="22222222-2222-2222-2222-222222222222"

pass() { PASS=$((PASS + 1)); printf 'pass: %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$1" >&2; }

write_stat_full() {
  local pid="$1" ppid="$2" tick="$3" state="${4:-S}"
  local fields="$state $ppid" k
  for ((k = 0; k < 17; k += 1)); do fields+=' 0'; done
  fields+=" $tick"
  mkdir -p "$WORK/proc/$pid"
  printf '%s (kwin_wayland) %s\n' "$pid" "$fields" > "$WORK/proc/$pid/stat"
}

write_cgroup() {
  local pid="$1" value="$2"
  mkdir -p "$WORK/proc/$pid"
  printf '%s\n' "$value" > "$WORK/proc/$pid/cgroup"
}

write_show() {
  local exec_path="$1" mainpid="${2:-$MAIN_PID}"
  cat > "$WORK/state/systemctl-show" <<EOF
Id=plasma-kwin_wayland.service
ActiveState=active
SubState=running
MainPID=$mainpid
Type=dbus
BusName=org.kde.KWinWrapper
ExecStart={ path=$exec_path ; argv[]=$exec_path --socket test ; ignore=no }
FragmentPath=/run/systemd/user/plasma-kwin_wayland.service
SourcePath=
EOF
}

setup_base() {
  mkdir -p "$WORK/fakebin" "$WORK/pkg/bin" "$WORK/pkg2/bin" "$WORK/state"
  printf 'kwin-launcher-fixture\n' > "$LAUNCHER"
  chmod 555 "$LAUNCHER"
  printf 'kwin-wrapped-fixture\n' > "$WRAPPED"
  chmod 555 "$WRAPPED"
  printf 'other-binary-fixture\n' > "$OTHER_FILE"
  chmod 555 "$OTHER_FILE"
  printf 'other-launcher\n' > "$OTHER_LAUNCHER"
  chmod 555 "$OTHER_LAUNCHER"
  printf 'other-wrapped\n' > "$OTHER_WRAPPED"
  chmod 555 "$OTHER_WRAPPED"
  write_stat_full "$MAIN_PID" "1" "$MAIN_TICK"
  write_stat_full "$OWNER_PID" "$MAIN_PID" "$OWNER_TICK"
  write_stat_full "$INTERMEDIATE_PID" "$MAIN_PID" "$INTERMEDIATE_TICK"
  write_cgroup "$OWNER_PID" "0::/"
  mkdir -p "$WORK/proc/sys/kernel/random"
  printf '%s\n' "$BOOT_ID" > "$WORK/proc/sys/kernel/random/boot_id"
  cat > "$WORK/fakebin/systemctl" <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
state="${FAKE_ID_STATE:-}"
[[ -n "$state" && -d "$state" ]] || { echo "fake systemctl: missing state" >&2; exit 1; }
joined="$*"
case "$joined" in
  *"show plasma-kwin_wayland.service"*) ;;
  *) echo "fake systemctl: unexpected call: $joined" >&2; exit 1 ;;
esac
cat "$state/systemctl-show"
EOF
  chmod 555 "$WORK/fakebin/systemctl"
}

restore_valid_stats() {
  write_stat_full "$MAIN_PID" "1" "$MAIN_TICK"
  write_stat_full "$OWNER_PID" "$MAIN_PID" "$OWNER_TICK"
  write_stat_full "$INTERMEDIATE_PID" "$MAIN_PID" "$INTERMEDIATE_TICK"
  write_cgroup "$OWNER_PID" "0::/"
  printf '%s\n' "$BOOT_ID" > "$WORK/proc/sys/kernel/random/boot_id"
  rm -f "$WORK/proc/$OWNER_PID/exe" "$WORK/proc/$MAIN_PID/exe"
  write_show "$LAUNCHER"
}

# Gated hermetic run of the direct-parent fallback.
run_dp() {
  local owner="$1" pid="$2" tick="$3"
  shift 3 || true
  set +e
  SYSTEMCTL_BIN="$WORK/fakebin/systemctl" PROC_ROOT="$WORK/proc" \
    POC3_KWIN_IDENTITY_TEST_ALLOW_NONPROC=1 POC3_KWIN_IDENTITY_TEST_ALLOW_NONSTORE=1 \
    FAKE_ID_STATE="$WORK/state" \
    "$BASH_BIN" -c '. "$1"; poc3_kwin_direct_parent_fallback "$2" "$3" "$4"' _ "$TOOL" "$owner" "$pid" "$tick" "$@" >"$OUTPUT" 2>&1
  VALID_EXIT=$?
  set -e
}

# Hermetic run with a custom systemctl shim (mid-run drift shapes).
run_dp_shim() {
  local shim="$1" owner="$2" pid="$3" tick="$4"
  set +e
  SYSTEMCTL_BIN="$shim" PROC_ROOT="$WORK/proc" \
    POC3_KWIN_IDENTITY_TEST_ALLOW_NONPROC=1 POC3_KWIN_IDENTITY_TEST_ALLOW_NONSTORE=1 \
    FAKE_ID_STATE="$WORK/state" \
    "$BASH_BIN" -c '. "$1"; poc3_kwin_direct_parent_fallback "$2" "$3" "$4"' _ "$TOOL" "$owner" "$pid" "$tick" >"$OUTPUT" 2>&1
  VALID_EXIT=$?
  set -e
}

# Production-shaped run: non-store gate unset.
run_dp_prod_store() {
  local owner="$1" pid="$2" tick="$3"
  set +e
  SYSTEMCTL_BIN="$WORK/fakebin/systemctl" PROC_ROOT="$WORK/proc" \
    POC3_KWIN_IDENTITY_TEST_ALLOW_NONPROC=1 FAKE_ID_STATE="$WORK/state" \
    "$BASH_BIN" -c '. "$1"; poc3_kwin_direct_parent_fallback "$2" "$3" "$4"' _ "$TOOL" "$owner" "$pid" "$tick" >"$OUTPUT" 2>&1
  VALID_EXIT=$?
  set -e
}

# Other fallback mode (systemd, not direct-parent) for cgroup-scope proof.
run_sys() {
  local owner="$1" pid="$2" tick="$3"
  set +e
  SYSTEMCTL_BIN="$WORK/fakebin/systemctl" PROC_ROOT="$WORK/proc" \
    POC3_KWIN_IDENTITY_TEST_ALLOW_NONPROC=1 POC3_KWIN_IDENTITY_TEST_ALLOW_NONSTORE=1 \
    FAKE_ID_STATE="$WORK/state" \
    "$BASH_BIN" -c '. "$1"; poc3_kwin_systemd_fallback "$2" "$3" "$4"' _ "$TOOL" "$owner" "$pid" "$tick" >"$OUTPUT" 2>&1
  VALID_EXIT=$?
  set -e
}

expect_fail_contains() {
  local name="$1" needle="$2"
  if [[ "$VALID_EXIT" -ne 0 ]] && grep -Fq "$needle" "$OUTPUT"; then
    pass "$name"
  else
    printf 'FAIL: %s (expected failure containing "%s", exit %s)\n' "$name" "$needle" "$VALID_EXIT" >&2
    cat "$OUTPUT" >&2
    FAIL=$((FAIL + 1))
  fi
}

capture_receipt() {
  local owner="$1" pid="$2" tick="$3" receipt="$4"
  run_dp "$owner" "$pid" "$tick"
  [[ "$VALID_EXIT" -eq 0 ]] || return 1
  { printf '%s\n%s\n%s\n' "$owner" "$pid" "$tick"; cat "$OUTPUT"; } > "$receipt"
}

revalidate_receipt() {
  local receipt="$1" owner="$2" pid="$3" tick="$4"
  local r_owner r_pid r_tick
  r_owner="$(sed -n '1p' "$receipt")"
  r_pid="$(sed -n '2p' "$receipt")"
  r_tick="$(sed -n '3p' "$receipt")"
  [[ "$owner" == "$r_owner" ]] || { echo "owner drift: $owner != $r_owner" >&2; return 1; }
  [[ "$pid" == "$r_pid" ]] || { echo "pid drift: $pid != $r_pid" >&2; return 1; }
  [[ "$tick" == "$r_tick" ]] || { echo "tick drift: $tick != $r_tick" >&2; return 1; }
  run_dp "$owner" "$pid" "$tick"
  [[ "$VALID_EXIT" -eq 0 ]] || return 1
  tail -n +4 "$receipt" > "$FRESH.expected"
  if ! cmp -s "$FRESH.expected" "$OUTPUT"; then
    echo "identity drift: live identity differs from receipt" >&2
    return 1
  fi
}

setup_base

# 0. Syntax.
if "$BASH_BIN" -n "$TOOL"; then pass "bash -n syntax"; else fail "bash -n syntax"; fi

# 1. Valid direct parent accepted: 25 lines, pinned pair/PPid/cgroup/mode.
restore_valid_stats
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
exp_wsha="$(sha256sum -- "$WRAPPED" | awk '{print $1}')"
exp_wdev="$(stat -c '%d' -- "$WRAPPED")"
exp_wino="$(stat -c '%i' -- "$WRAPPED")"
exp_wmode="$(stat -c '%a' -- "$WRAPPED")"
exp_lsha="$(sha256sum -- "$LAUNCHER" | awk '{print $1}')"
exp_ldev="$(stat -c '%d' -- "$LAUNCHER")"
exp_lino="$(stat -c '%i' -- "$LAUNCHER")"
exp_lmode="$(stat -c '%a' -- "$LAUNCHER")"
if [[ "$VALID_EXIT" -eq 0 ]] && [[ "$(wc -l < "$OUTPUT")" -eq 25 ]] \
  && [[ "$(sed -n '1p' "$OUTPUT")" == "$WRAPPED" ]] \
  && [[ "$(sed -n '2p' "$OUTPUT")" == "$BOOT_ID" ]] \
  && [[ "$(sed -n '3p' "$OUTPUT")" == "$exp_wsha" ]] \
  && [[ "$(sed -n '4p' "$OUTPUT")" == "$exp_wdev" ]] \
  && [[ "$(sed -n '5p' "$OUTPUT")" == "$exp_wino" ]] \
  && [[ "$(sed -n '6p' "$OUTPUT")" == "$exp_wmode" ]] \
  && [[ "$(sed -n '7p' "$OUTPUT")" == "$LAUNCHER" ]] \
  && [[ "$(sed -n '8p' "$OUTPUT")" == "$exp_lsha" ]] \
  && [[ "$(sed -n '9p' "$OUTPUT")" == "$exp_ldev" ]] \
  && [[ "$(sed -n '10p' "$OUTPUT")" == "$exp_lino" ]] \
  && [[ "$(sed -n '11p' "$OUTPUT")" == "$exp_lmode" ]] \
  && [[ "$(sed -n '12p' "$OUTPUT")" == "$PKG_ROOT" ]] \
  && [[ "$(sed -n '13p' "$OUTPUT")" == "plasma-kwin_wayland.service" ]] \
  && [[ "$(sed -n '14p' "$OUTPUT")" == "active" ]] \
  && [[ "$(sed -n '15p' "$OUTPUT")" == "running" ]] \
  && [[ "$(sed -n '16p' "$OUTPUT")" == "$MAIN_PID" ]] \
  && [[ "$(sed -n '17p' "$OUTPUT")" == "$MAIN_TICK" ]] \
  && [[ "$(sed -n '18p' "$OUTPUT")" == "$MAIN_PID" ]] \
  && [[ "$(sed -n '19p' "$OUTPUT")" == "0::/" ]] \
  && [[ "$(sed -n '20p' "$OUTPUT")" == "dbus" ]] \
  && [[ "$(sed -n '21p' "$OUTPUT")" == "org.kde.KWinWrapper" ]] \
  && [[ "$(sed -n '22p' "$OUTPUT")" == "$LAUNCHER" ]] \
  && [[ "$(sed -n '25p' "$OUTPUT")" == "direct-parent" ]]; then
  pass "valid direct parent pins pair/ppid/main-tick/cgroup/mode"
else
  fail "valid direct parent pins pair/ppid/main-tick/cgroup/mode"
  cat "$OUTPUT" >&2
fi
# Agreeing readable wrapped exe on both owner and MainPID still accepted.
ln -s "$WRAPPED" "$WORK/proc/$OWNER_PID/exe"
ln -s "$WRAPPED" "$WORK/proc/$MAIN_PID/exe"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
if [[ "$VALID_EXIT" -eq 0 ]] && [[ "$(wc -l < "$OUTPUT")" -eq 25 ]]; then
  pass "agreeing wrapped owner+MainPID exe accepted"
else
  fail "agreeing wrapped owner+MainPID exe accepted"
  cat "$OUTPUT" >&2
fi
rm -f "$WORK/proc/$OWNER_PID/exe" "$WORK/proc/$MAIN_PID/exe"
RECEIPT="$WORK/receipt.txt"
if capture_receipt "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK" "$RECEIPT"; then
  pass "receipt capture succeeds"
else
  fail "receipt capture succeeds"
fi
if revalidate_receipt "$RECEIPT" "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK" >"$REV" 2>&1; then pass "unchanged receipt revalidates"; else fail "unchanged receipt revalidates"; cat "$REV" >&2; fi

# 2. Grandchild rejected (one level only; deeper descendants refused).
restore_valid_stats
write_stat_full "$OWNER_PID" "$INTERMEDIATE_PID" "$OWNER_TICK"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "grandchild (two levels below MainPID) refuses" "not the direct unit MainPID"
restore_valid_stats

# 3. Sibling rejected; owner equal to MainPID rejected for this mode.
write_stat_full "$OWNER_PID" "1" "$OWNER_TICK"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "sibling (unrelated PPid) refuses" "not the direct unit MainPID"
restore_valid_stats
write_cgroup "$MAIN_PID" "0::/"
run_dp "$PROC_OWNER" "$MAIN_PID" "$MAIN_TICK"
expect_fail_contains "owner equal to MainPID refuses direct-parent mode" "below the unit MainPID"
restore_valid_stats

# 4. PPid drift rejected: fresh PPid change fails; mid-run PPid rewrite fails.
write_stat_full "$OWNER_PID" "3000" "$OWNER_TICK"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "changed PPid refuses" "not the direct unit MainPID"
restore_valid_stats
cat > "$WORK/fakebin/systemctl-mutating-ppid" <<EOF
#!/usr/bin/env bash
set -uo pipefail
state="\${FAKE_ID_STATE:-}"
[[ -n "\$state" && -d "\$state" ]] || exit 1
_mf="S 3000"
for ((_k = 0; _k < 17; _k += 1)); do _mf+=' 0'; done
_mf+=" $OWNER_TICK"
printf '%s (kwin_wayland) %s\n' "$OWNER_PID" "\$_mf" > "$WORK/proc/$OWNER_PID/stat"
cat "\$state/systemctl-show"
EOF
chmod 555 "$WORK/fakebin/systemctl-mutating-ppid"
run_dp_shim "$WORK/fakebin/systemctl-mutating-ppid" "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "mid-run PPid drift refuses" "parent drift"
restore_valid_stats

# 5. Owner PID reuse/start-tick drift rejected.
write_stat_full "$OWNER_PID" "$MAIN_PID" "999999"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "owner start-tick drift refuses" "start-tick mismatch"
restore_valid_stats
# PID reuse shape: stat PID disagrees with requested PID (valid tick shape).
_reuse="S $MAIN_PID"
for ((_k = 0; _k < 17; _k += 1)); do _reuse+=' 0'; done
_reuse+=" $OWNER_TICK"
printf '%s (kwin_wayland) %s\n' "2999" "$_reuse" > "$WORK/proc/$OWNER_PID/stat"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "owner PID reuse (stat PID mismatch) refuses" "stale or unreadable"
restore_valid_stats
cat > "$WORK/fakebin/systemctl-mutating-tick" <<EOF
#!/usr/bin/env bash
set -uo pipefail
state="\${FAKE_ID_STATE:-}"
[[ -n "\$state" && -d "\$state" ]] || exit 1
_mf="S $MAIN_PID"
for ((_k = 0; _k < 17; _k += 1)); do _mf+=' 0'; done
_mf+=" 999999"
printf '%s (kwin_wayland) %s\n' "$OWNER_PID" "\$_mf" > "$WORK/proc/$OWNER_PID/stat"
cat "\$state/systemctl-show"
EOF
chmod 555 "$WORK/fakebin/systemctl-mutating-tick"
run_dp_shim "$WORK/fakebin/systemctl-mutating-tick" "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "mid-run owner tick reuse refuses" "start-tick mismatch"
restore_valid_stats
if revalidate_receipt "$RECEIPT" "$PROC_OWNER" "$OWNER_PID" "999999" >"$REV" 2>&1; then fail "receipt tick drift refuses"; else
  if grep -Fq "tick drift" "$REV"; then pass "receipt tick drift refuses"; else fail "receipt tick drift refuses"; cat "$REV" >&2; fi
fi
if revalidate_receipt "$RECEIPT" "$PROC_OWNER" "2999" "$OWNER_TICK" >"$REV" 2>&1; then fail "receipt PID drift refuses"; else
  if grep -Fq "pid drift" "$REV"; then pass "receipt PID drift refuses"; else fail "receipt PID drift refuses"; cat "$REV" >&2; fi
fi

# 6. Service MainPID restart/tick drift rejected (same PID, new tick).
restore_valid_stats
write_stat_full "$MAIN_PID" "1" "299999"
if revalidate_receipt "$RECEIPT" "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK" >"$REV" 2>&1; then fail "MainPID tick restart refuses old receipt"; else
  if grep -Fq "identity drift" "$REV"; then pass "MainPID tick restart refuses old receipt"; else fail "MainPID tick restart refuses old receipt"; cat "$REV" >&2; fi
fi
restore_valid_stats
write_show "$LAUNCHER" "2999"
mkdir -p "$WORK/proc/2999"
write_stat_full "2999" "1" "299900"
if revalidate_receipt "$RECEIPT" "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK" >"$REV" 2>&1; then fail "MainPID replacement refuses old receipt"; else pass "MainPID replacement refuses old receipt"; fi
rm -rf "$WORK/proc/2999"
restore_valid_stats
write_show "$LAUNCHER" "9999"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "wrong MainPID refuses" "not the direct unit MainPID"
restore_valid_stats

# 7. D-Bus owner drift rejected (caller-pinned unique name).
if revalidate_receipt "$RECEIPT" ":1.11" "$OWNER_PID" "$OWNER_TICK" >"$REV" 2>&1; then fail "receipt owner drift refuses"; else
  if grep -Fq "owner drift" "$REV"; then pass "receipt owner drift refuses"; else fail "receipt owner drift refuses"; cat "$REV" >&2; fi
fi
run_dp "not-unique" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "non-unique owner refuses" "unique name"

# 8. Root cgroup accepted only under direct-parent mode.
restore_valid_stats
write_cgroup "$OWNER_PID" "0::/user.slice/user-1000.slice/session-2.scope"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "non-root cgroup refuses direct-parent mode" "host-pilot root"
rm -f "$WORK/proc/$OWNER_PID/cgroup"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "missing cgroup refuses direct-parent mode" "host-pilot root"
restore_valid_stats
# Other fallback mode ignores cgroup: same pair/unit binds as 21-line
# systemd identity with no cgroup or direct-parent mode claim.
write_cgroup "$OWNER_PID" "0::/"
write_stat_full "$MAIN_PID" "1" "$MAIN_TICK"
run_sys "$PROC_OWNER" "$MAIN_PID" "$MAIN_TICK"
if [[ "$VALID_EXIT" -eq 0 ]] && [[ "$(wc -l < "$OUTPUT")" -eq 21 ]] \
  && ! grep -Fq "0::/" "$OUTPUT" && ! grep -Fq "direct-parent" "$OUTPUT"; then
  pass "systemd mode binds without cgroup/direct-parent claim"
else
  fail "systemd mode binds without cgroup/direct-parent claim"
  cat "$OUTPUT" >&2
fi
# Systemd mode still binds when the owner cgroup is non-root (cgroup is not
# its identity fact); direct-parent mode refuses the same fixture.
write_cgroup "$MAIN_PID" "0::/user.slice/user-1000.slice/session-2.scope"
run_sys "$PROC_OWNER" "$MAIN_PID" "$MAIN_TICK"
if [[ "$VALID_EXIT" -eq 0 ]]; then pass "systemd mode ignores non-root cgroup"; else fail "systemd mode ignores non-root cgroup"; cat "$OUTPUT" >&2; fi
rm -f "$WORK/proc/$MAIN_PID/cgroup"
write_cgroup "$OWNER_PID" "0::/user.slice/user-1000.slice/session-2.scope"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "direct-parent still refuses non-root while systemd ignores it" "host-pilot root"
restore_valid_stats
# Mid-run cgroup drift fails closed.
cat > "$WORK/fakebin/systemctl-mutating-cgroup" <<EOF
#!/usr/bin/env bash
set -uo pipefail
state="\${FAKE_ID_STATE:-}"
[[ -n "\$state" && -d "\$state" ]] || exit 1
printf '%s\n' "0::/user.slice/user-1000.slice/session-2.scope" > "$WORK/proc/$OWNER_PID/cgroup"
cat "\$state/systemctl-show"
EOF
chmod 555 "$WORK/fakebin/systemctl-mutating-cgroup"
run_dp_shim "$WORK/fakebin/systemctl-mutating-cgroup" "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "mid-run cgroup drift refuses" "cgroup drift"
restore_valid_stats

# 9. Readable exe disagreement rejected (owner and MainPID separately, wrapped only).
ln -s "$OTHER_FILE" "$WORK/proc/$OWNER_PID/exe"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "owner sibling exe refuses" "disagrees"
rm -f "$WORK/proc/$OWNER_PID/exe"
ln -s "$LAUNCHER" "$WORK/proc/$OWNER_PID/exe"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "owner launcher-only exe refuses (wrapped-only pin)" "disagrees"
rm -f "$WORK/proc/$OWNER_PID/exe"
ln -s "$OTHER_WRAPPED" "$WORK/proc/$OWNER_PID/exe"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "owner cross-package wrapped refuses" "disagrees"
rm -f "$WORK/proc/$OWNER_PID/exe"
ln -s "$OTHER_FILE" "$WORK/proc/$MAIN_PID/exe"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "MainPID sibling exe refuses" "MainPID executable"
rm -f "$WORK/proc/$MAIN_PID/exe"
ln -s "$LAUNCHER" "$WORK/proc/$MAIN_PID/exe"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "MainPID launcher-only exe refuses (wrapped-only pin)" "MainPID executable"
rm -f "$WORK/proc/$MAIN_PID/exe"
ln -s "$OTHER_WRAPPED" "$WORK/proc/$MAIN_PID/exe"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "MainPID cross-package wrapped refuses" "MainPID executable"
rm -f "$WORK/proc/$MAIN_PID/exe"
restore_valid_stats

# 10. Unit and ExecStart drift rejected.
cat > "$WORK/state/systemctl-show" <<EOF
Id=plasma-kwin_wayland.service
ActiveState=inactive
SubState=running
MainPID=$MAIN_PID
Type=dbus
BusName=org.kde.KWinWrapper
ExecStart={ path=$LAUNCHER ; ignore=no }
FragmentPath=/run/systemd/user/plasma-kwin_wayland.service
SourcePath=
EOF
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "inactive ActiveState refuses" "not active"
restore_valid_stats
cat > "$WORK/state/systemctl-show" <<EOF
Id=plasma-kwin_wayland.service
ActiveState=active
SubState=running
MainPID=$MAIN_PID
Type=simple
BusName=org.kde.KWinWrapper
ExecStart={ path=$LAUNCHER ; ignore=no }
FragmentPath=/run/systemd/user/plasma-kwin_wayland.service
SourcePath=
EOF
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "Type mismatch refuses" "Type"
restore_valid_stats
cat > "$WORK/state/systemctl-show" <<EOF
Id=plasma-kwin_wayland.service
ActiveState=active
SubState=running
MainPID=$MAIN_PID
Type=dbus
BusName=org.kde.Other
ExecStart={ path=$LAUNCHER ; ignore=no }
FragmentPath=/run/systemd/user/plasma-kwin_wayland.service
SourcePath=
EOF
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "BusName mismatch refuses" "BusName"
restore_valid_stats
cat > "$WORK/state/systemctl-show" <<EOF
Id=plasma-kwin_wayland.service
ActiveState=active
SubState=running
MainPID=$MAIN_PID
Type=dbus
BusName=org.kde.KWinWrapper
ExecStart={ path=$LAUNCHER ; ignore=no } { path=$LAUNCHER ; ignore=no }
FragmentPath=/run/systemd/user/plasma-kwin_wayland.service
SourcePath=
EOF
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "multiple ExecStart commands refuse" "ambiguous"
restore_valid_stats
write_show "/usr/bin/kwin_wayland_wrapper"
run_dp_prod_store "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "non-store ExecStart refuses in production" "wrapper-pair"
restore_valid_stats
write_show "$OTHER_LAUNCHER"
if revalidate_receipt "$RECEIPT" "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK" >"$REV" 2>&1; then fail "receipt ExecStart drift refuses"; else
  if grep -Fq "identity drift" "$REV"; then pass "receipt ExecStart drift refuses"; else fail "receipt ExecStart drift refuses"; cat "$REV" >&2; fi
fi
restore_valid_stats
printf '%s\n' "$BOOT_ID2" > "$WORK/proc/sys/kernel/random/boot_id"
if revalidate_receipt "$RECEIPT" "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK" >"$REV" 2>&1; then fail "receipt boot drift refuses"; else
  if grep -Fq "identity drift" "$REV"; then pass "receipt boot drift refuses"; else fail "receipt boot drift refuses"; cat "$REV" >&2; fi
fi
# Hermetic direct-parent run with `set -u` active in the callee shell.
run_dp_setu() {
  local owner="$1" pid="$2" tick="$3"
  set +e
  SYSTEMCTL_BIN="$WORK/fakebin/systemctl" PROC_ROOT="$WORK/proc" \
    POC3_KWIN_IDENTITY_TEST_ALLOW_NONPROC=1 POC3_KWIN_IDENTITY_TEST_ALLOW_NONSTORE=1 \
    FAKE_ID_STATE="$WORK/state" \
    "$BASH_BIN" -c 'set -u; . "$1"; poc3_kwin_direct_parent_fallback "$2" "$3" "$4"' _ "$TOOL" "$owner" "$pid" "$tick" >"$OUTPUT" 2>&1
  VALID_EXIT=$?
  set -e
}

# Production-gate store-shape check with `set -u` (covers the Nix-store
# hash-split parsing on the direct-parent runtime path; the fixture gate
# stays unset so the hash-split lines are reached).
run_store_ok_setu() {
  local candidate="$1"
  set +e
  POC3_KWIN_IDENTITY_TEST_ALLOW_NONSTORE=0 \
    "$BASH_BIN" -c 'set -u; . "$1"; poc3_kwin_identity_store_ok "$2"' _ "$TOOL" "$candidate" >"$OUTPUT" 2>&1
  VALID_EXIT=$?
  set -e
}

restore_valid_stats

# 11. `set -u` tolerance on the direct-parent runtime path: the Nix-store
# hash-split parsing must not trip unbound-variable, and malformed input
# must stay fail-closed.
run_dp_setu "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
if [[ "$VALID_EXIT" -eq 0 ]] && [[ "$(wc -l < "$OUTPUT")" -eq 25 ]] \
  && [[ "$(sed -n '25p' "$OUTPUT")" == "direct-parent" ]]; then
  pass "direct-parent fallback tolerates set -u (valid)"
else
  fail "direct-parent fallback tolerates set -u (valid)"
  cat "$OUTPUT" >&2
fi
write_stat_full "$OWNER_PID" "1" "$OWNER_TICK"
run_dp_setu "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "direct-parent under set -u still refuses sibling PPid" "not the direct unit MainPID"
restore_valid_stats
run_store_ok_setu "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-kwin-wayland/bin/kwin_wayland"
if [[ "$VALID_EXIT" -eq 0 ]]; then
  pass "store identity parses under set -u (valid)"
else
  fail "store identity parses under set -u (valid)"
  cat "$OUTPUT" >&2
fi
for _bad in "/usr/bin/kwin_wayland" "/nix/store/short-name" \
  "/nix/store/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA-name" \
  "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-name (deleted)" ""; do
  run_store_ok_setu "$_bad"
  if [[ "$VALID_EXIT" -ne 0 ]]; then
    pass "store identity under set -u refuses [${_bad:-<empty>}]"
  else
    fail "store identity under set -u refuses [${_bad:-<empty>}]"
  fi
done
restore_valid_stats

# 12. Wrapper-pair hardening for direct-parent mode.
write_show "$WORK/pkg/bin/kwin_wayland"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "wrong launcher basename refuses" "wrapper-pair"
restore_valid_stats
mv "$WRAPPED" "$WORK/pkg/bin/wrapped-bak"
printf 'sibling\n' > "$WORK/pkg/bin/arbitrary-sibling"
chmod 555 "$WORK/pkg/bin/arbitrary-sibling"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "arbitrary sibling (missing wrapped) refuses" "wrapper-pair"
rm -f "$WORK/pkg/bin/arbitrary-sibling"
mv "$WORK/pkg/bin/wrapped-bak" "$WRAPPED"
restore_valid_stats
mv "$WRAPPED" "$WORK/pkg/bin/wrapped-bak2"
ln -s "$OTHER_WRAPPED" "$WRAPPED"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "different store package symlink refuses" "wrapper-pair"
rm -f "$WRAPPED"
mv "$WORK/pkg/bin/wrapped-bak2" "$WRAPPED"
restore_valid_stats
mv "$LAUNCHER" "$WORK/pkg/bin/launcher-real"
ln -s "$WORK/pkg/bin/launcher-real" "$LAUNCHER"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "launcher symlink refuses" "wrapper-pair"
rm -f "$LAUNCHER"
mv "$WORK/pkg/bin/launcher-real" "$LAUNCHER"
restore_valid_stats
mv "$WRAPPED" "$WORK/pkg/bin/wrapped-real"
ln -s "$WORK/pkg/bin/wrapped-real" "$WRAPPED"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "wrapped symlink refuses" "wrapper-pair"
rm -f "$WRAPPED"
mv "$WORK/pkg/bin/wrapped-real" "$WRAPPED"
restore_valid_stats
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
cp "$OUTPUT" "$WORK/good-dp.txt"
chmod u+w "$WRAPPED"
printf 'tampered\n' > "$WRAPPED"
chmod 555 "$WRAPPED"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
if [[ "$VALID_EXIT" -eq 0 ]] && ! cmp -s "$WORK/good-dp.txt" "$OUTPUT"; then pass "wrapped hash drift changes identity"; else fail "wrapped hash drift changes identity"; cat "$OUTPUT" >&2; fi
chmod u+w "$WRAPPED"
printf 'kwin-wrapped-fixture\n' > "$WRAPPED"
chmod 555 "$WRAPPED"
restore_valid_stats
rm -f "$WRAPPED"
printf 'kwin-wrapped-fixture\n' > "$WRAPPED"
chmod 555 "$WRAPPED"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
if [[ "$VALID_EXIT" -eq 0 ]] && ! cmp -s "$WORK/good-dp.txt" "$OUTPUT"; then pass "wrapped inode replacement changes identity"; else fail "wrapped inode replacement changes identity"; cat "$OUTPUT" >&2; fi
restore_valid_stats
chmod -x "$LAUNCHER"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "nonexecutable launcher refuses" "wrapper-pair"
chmod 555 "$LAUNCHER"
chmod -x "$WRAPPED"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "nonexecutable wrapped refuses" "wrapper-pair"
chmod 555 "$WRAPPED"
rm -f "$LAUNCHER"
mkdir "$LAUNCHER"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "nonregular launcher refuses" "wrapper-pair"
rmdir "$LAUNCHER"
printf 'kwin-launcher-fixture\n' > "$LAUNCHER"
chmod 555 "$LAUNCHER"
rm -f "$WRAPPED"
mkdir "$WRAPPED"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "nonregular wrapped refuses" "wrapper-pair"
rmdir "$WRAPPED"
printf 'kwin-wrapped-fixture\n' > "$WRAPPED"
chmod 555 "$WRAPPED"
restore_valid_stats
chmod 755 "$LAUNCHER"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "writable launcher mode refuses" "wrapper-pair"
chmod 555 "$LAUNCHER"
chmod 755 "$WRAPPED"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "writable wrapped mode refuses" "wrapper-pair"
chmod 555 "$WRAPPED"
restore_valid_stats
cp "$WRAPPED" "$WORK/dp-proc-copy"
chmod 555 "$WORK/dp-proc-copy"
ln -s "$WORK/dp-proc-copy" "$WORK/proc/$OWNER_PID/exe"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "owner live proc hash/inode mismatch refuses" "disagrees"
rm -f "$WORK/proc/$OWNER_PID/exe"
ln -s "$WORK/dp-proc-copy" "$WORK/proc/$MAIN_PID/exe"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
expect_fail_contains "MainPID live proc hash/inode mismatch refuses" "MainPID executable"
rm -f "$WORK/proc/$MAIN_PID/exe"
restore_valid_stats
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
cp "$OUTPUT" "$WORK/good-dp2.txt"
rm -f "$WRAPPED"
printf 'kwin-wrapped-fixture\n' > "$WRAPPED"
chmod 555 "$WRAPPED"
run_dp "$PROC_OWNER" "$OWNER_PID" "$OWNER_TICK"
if cmp -s "$WORK/good-dp2.txt" "$OUTPUT"; then fail "direct-parent pin revalidation must observe replacement drift"; else pass "direct-parent pin revalidation observes replacement drift"; fi
restore_valid_stats

printf 'poc3-host-kwin-identity-direct-parent static: pass=%s fail=%s\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
