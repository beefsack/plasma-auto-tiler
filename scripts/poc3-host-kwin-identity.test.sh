#!/usr/bin/env bash
# Static tests for scripts/poc3-host-kwin-identity.sh (canonical shared helper).
#
# No live execution: never touches host D-Bus, systemctl --user, or real
# /proc. All inputs are synthetic fixtures under a temp dir (fake systemctl
# shim, fake PROC_ROOT, fixture store file). Every failing case must fail
# closed with no partial identity.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TOOL="$REPO_ROOT/scripts/poc3-host-kwin-identity.sh"
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
PKG_ROOT="$WORK/pkg"
LAUNCHER="$PKG_ROOT/bin/kwin_wayland_wrapper"
WRAPPED="$PKG_ROOT/bin/.kwin_wayland_wrapper-wrapped"
STORE_FILE="$WRAPPED"
OTHER_FILE="$WORK/pkg/bin/other_bin"
OTHER_PKG_ROOT="$WORK/pkg2"
OTHER_LAUNCHER="$OTHER_PKG_ROOT/bin/kwin_wayland_wrapper"
OTHER_WRAPPED="$OTHER_PKG_ROOT/bin/.kwin_wayland_wrapper-wrapped"
PROC_PID="4242"
PROC_TICK="424200"
PROC_OWNER=":1.10"
BOOT_ID="12345678-1234-1234-1234-123456789abc"

pass() { PASS=$((PASS + 1)); printf 'pass: %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$1" >&2; }

setup_base() {
  mkdir -p "$WORK/fakebin" "$WORK/proc/$PROC_PID" "$WORK/pkg/bin" "$WORK/pkg2/bin" "$WORK/state"
  printf 'kwin-launcher-fixture\n' > "$LAUNCHER"
  chmod 555 "$LAUNCHER"
  printf 'kwin-wrapped-fixture\n' > "$WRAPPED"
  chmod 555 "$WRAPPED"
  printf 'other-binary-fixture\n' > "$OTHER_FILE"
  chmod 555 "$OTHER_FILE"
  printf 'kwin-launcher-other-pkg\n' > "$OTHER_LAUNCHER"
  chmod 555 "$OTHER_LAUNCHER"
  printf 'kwin-wrapped-other-pkg\n' > "$OTHER_WRAPPED"
  chmod 555 "$OTHER_WRAPPED"
  local fields="S"
  local k
  for ((k = 1; k < 19; k += 1)); do fields+=' 0'; done
  fields+=" $PROC_TICK"
  printf '%s (kwin_wayland) %s\n' "$PROC_PID" "$fields" > "$WORK/proc/$PROC_PID/stat"
  mkdir -p "$WORK/proc/sys/kernel/random"
  printf '%s\n' "$BOOT_ID" > "$WORK/proc/sys/kernel/random/boot_id"
  cat > "$WORK/fakebin/systemctl" <<'EOF'
#!/usr/bin/env bash
# Fixture systemctl: only the exact read-only show for the KWin unit.
set -uo pipefail
state="${FAKE_ID_STATE:-}"
[[ -n "$state" && -d "$state" ]] || { echo "fake systemctl: missing state" >&2; exit 1; }
if [[ -f "$state/systemctl-down" ]]; then
  echo "fake systemctl: unit unavailable" >&2
  exit 1
fi
joined="$*"
case "$joined" in
  *"show plasma-kwin_wayland.service"*) ;;
  *) echo "fake systemctl: unexpected call: $joined" >&2; exit 1 ;;
esac
cat "$state/systemctl-show"
EOF
  chmod +x "$WORK/fakebin/systemctl"
}

write_show() {
  local exec_path="$1" mainpid="${2:-$PROC_PID}" extra="${3:-}"
  cat > "$WORK/state/systemctl-show" <<EOF
Id=plasma-kwin_wayland.service
ActiveState=active
SubState=running
MainPID=$mainpid
Type=dbus
BusName=org.kde.KWinWrapper
ExecStart={ path=$exec_path ; argv[]=$exec_path --socket test ; ignore=no ; start_time=[Thu 2026-01-01 00:00:00 UTC] }
FragmentPath=/run/systemd/user/plasma-kwin_wayland.service
SourcePath=
EOF
  if [[ -n "$extra" ]]; then
    printf '%s\n' "$extra" >> "$WORK/state/systemctl-show"
  fi
}

run_helper() {
  local owner="$1" pid="$2" tick="$3"
  shift 3 || true
  set +e
  SYSTEMCTL_BIN="$WORK/fakebin/systemctl" PROC_ROOT="$WORK/proc" \
    POC3_KWIN_IDENTITY_TEST_ALLOW_NONPROC=1 POC3_KWIN_IDENTITY_TEST_ALLOW_NONSTORE=1 \
    FAKE_ID_STATE="$WORK/state" \
    "$BASH_BIN" -c '. "$1"; poc3_kwin_systemd_fallback "$2" "$3" "$4"' _ "$TOOL" "$owner" "$pid" "$tick" "$@" >"$OUTPUT" 2>&1
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

setup_base

# 1. Syntax and source-only shape.
if "$BASH_BIN" -n "$TOOL"; then pass "bash -n syntax"; else fail "bash -n syntax"; fi
set +e
"$BASH_BIN" "$TOOL" >"$OUTPUT" 2>&1
_direct_exit=$?
set -e
if [[ "$_direct_exit" -ne 0 ]] && grep -Fq "source it" "$OUTPUT"; then pass "direct execution refused"; else fail "direct execution refused"; fi

# 2. No forbidden executable authorities.
assert_absent() {
  if grep -Fq -- "$1" "$TOOL"; then fail "forbidden present: $1"; else pass "absent: $1"; fi
}
assert_absent "pgrep"
assert_absent "pidof"
assert_absent "ps aux"
assert_absent "cmdline"
assert_absent "mktemp"
assert_absent "profile"
assert_absent "/etc/profile"
assert_absent "whoami"
assert_absent "kpackagetool"
assert_absent "journalctl"
assert_absent "kwinrc"
if grep -Eq '(^|[^a-zA-Z_])sleep([^a-zA-Z_]|$)' "$TOOL"; then fail "helper must not sleep/retry"; else pass "absent: sleep retry"; fi
if grep -Eq 'for |while .*do|until ' "$TOOL"; then
  # while-read for systemctl output parsing is the one allowed loop; any other
  # retry-shaped loop is forbidden. Check for sleep-backed retry specifically.
  if grep -Eq 'retry|Retry|RETRY' "$TOOL"; then fail "helper must not retry"; else pass "no retry loop"; fi
else
  pass "no retry loop"
fi
for field in 'Id' 'ActiveState' 'SubState' 'MainPID' 'ExecStart' 'FragmentPath' 'SourcePath'; do
  if grep -Fq "$field" "$TOOL"; then pass "uses field: $field"; else fail "missing field: $field"; fi
done
if grep -Fq 'org.kde.KWinWrapper' "$TOOL" && grep -Fq 'Type' "$TOOL"; then pass "pins Type/BusName"; else fail "pins Type/BusName"; fi
if grep -Fq 'return 42' "$TOOL" && grep -Fq 'Status 42 is an internal literal' "$TOOL"; then pass "documents the fixed MainPID-mismatch status"; else fail "documents the fixed MainPID-mismatch status"; fi

# 3. Success with /proc/exe absent (EACCES fallback shape): exact pair.
rm -f "$WORK/proc/$PROC_PID/exe"
write_show "$LAUNCHER"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
exp_lsha="$(sha256sum -- "$LAUNCHER" | awk '{print $1}')"
exp_ldev="$(stat -c '%d' -- "$LAUNCHER")"
exp_lino="$(stat -c '%i' -- "$LAUNCHER")"
exp_lmode="$(stat -c '%a' -- "$LAUNCHER")"
exp_wsha="$(sha256sum -- "$WRAPPED" | awk '{print $1}')"
exp_wdev="$(stat -c '%d' -- "$WRAPPED")"
exp_wino="$(stat -c '%i' -- "$WRAPPED")"
exp_wmode="$(stat -c '%a' -- "$WRAPPED")"
if [[ "$VALID_EXIT" -eq 0 ]] && [[ "$(sed -n '1p' "$OUTPUT")" == "$WRAPPED" ]] \
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
  && [[ "$(wc -l < "$OUTPUT")" -eq 21 ]]; then
  pass "fallback success with unreadable /proc/exe (exact pair)"
else
  fail "fallback success with unreadable /proc/exe (exact pair)"
  cat "$OUTPUT" >&2
fi

# 4. Success with /proc/exe readable and agreeing (wrapped only).
ln -s "$WRAPPED" "$WORK/proc/$PROC_PID/exe"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
if [[ "$VALID_EXIT" -eq 0 ]] && [[ "$(sed -n '1p' "$OUTPUT")" == "$WRAPPED" ]]; then
  pass "readable agreeing wrapped /proc/exe accepted"
else
  fail "readable agreeing wrapped /proc/exe accepted"
  cat "$OUTPUT" >&2
fi

# 5. Disagreement fails closed: arbitrary sibling, launcher-only, other pkg.
rm -f "$WORK/proc/$PROC_PID/exe"
ln -s "$OTHER_FILE" "$WORK/proc/$PROC_PID/exe"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "disagreeing sibling /proc/exe fails closed" "disagrees"
rm -f "$WORK/proc/$PROC_PID/exe"
ln -s "$LAUNCHER" "$WORK/proc/$PROC_PID/exe"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "launcher-only readable MainPID fails closed" "disagrees"
rm -f "$WORK/proc/$PROC_PID/exe"
ln -s "$OTHER_WRAPPED" "$WORK/proc/$PROC_PID/exe"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "cross-package wrapped /proc/exe fails closed" "disagrees"
rm -f "$WORK/proc/$PROC_PID/exe"

# 6. Multiple ExecStart commands rejected.
write_show "$LAUNCHER"
printf 'ExecStart={ path=%s ; ignore=no } { path=%s ; ignore=no }\n' "$LAUNCHER" "$LAUNCHER" > "$WORK/state/multi-extra"
cat > "$WORK/state/systemctl-show" <<EOF
Id=plasma-kwin_wayland.service
ActiveState=active
SubState=running
MainPID=$PROC_PID
Type=dbus
BusName=org.kde.KWinWrapper
ExecStart={ path=$LAUNCHER ; ignore=no } { path=$LAUNCHER ; ignore=no }
FragmentPath=/run/systemd/user/plasma-kwin_wayland.service
SourcePath=
EOF
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "multiple ExecStart rejected" "ambiguous"

# 7. Injection and escaped values rejected.
for inj in 'path=/tmp/evil\ with\ space' 'path="/tmp/evil"' "path='/tmp/evil'" 'path=/tmp/$evil' 'path=/tmp/`evil`' 'path=/tmp/a&b' 'path=/tmp/a|b' 'path=/tmp/a<b'; do
  cat > "$WORK/state/systemctl-show" <<EOF
Id=plasma-kwin_wayland.service
ActiveState=active
SubState=running
MainPID=$PROC_PID
Type=dbus
BusName=org.kde.KWinWrapper
ExecStart={ $inj ; ignore=no }
FragmentPath=/run/systemd/user/plasma-kwin_wayland.service
SourcePath=
EOF
  run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
  expect_fail_contains "injection rejected: $inj" "ambiguous"
done

# 8. Non-store ExecStart rejected in production (no NONSTORE gate).
write_show "/usr/bin/kwin_wayland_wrapper"
set +e
SYSTEMCTL_BIN="$WORK/fakebin/systemctl" PROC_ROOT="$WORK/proc" \
  POC3_KWIN_IDENTITY_TEST_ALLOW_NONPROC=1 FAKE_ID_STATE="$WORK/state" \
  "$BASH_BIN" -c '. "$1"; poc3_kwin_systemd_fallback "$2" "$3" "$4"' _ "$TOOL" "$PROC_OWNER" "$PROC_PID" "$PROC_TICK" >"$OUTPUT" 2>&1
VALID_EXIT=$?
set -e
expect_fail_contains "non-store ExecStart rejected in production" "wrapper-pair"

# 9. MainPID mismatch rejected with the fixed mismatch status only.
write_show "$LAUNCHER" "9999"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "MainPID mismatch rejected" "MainPID"
if [[ "$VALID_EXIT" -eq 42 ]]; then pass "exact MainPID mismatch returns the fixed status"; else fail "exact MainPID mismatch returns the fixed status"; fi
# Non-MainPID helper failure must not return the mismatch status.
cat > "$WORK/state/systemctl-show" <<EOF
Id=plasma-kwin_wayland.service
ActiveState=active
SubState=running
MainPID=$PROC_PID
Type=simple
BusName=org.kde.KWinWrapper
ExecStart={ path=$LAUNCHER ; ignore=no }
FragmentPath=/run/systemd/user/plasma-kwin_wayland.service
SourcePath=
EOF
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "Type mismatch still rejected" "Type"
if [[ "$VALID_EXIT" -ne 42 ]]; then pass "non-MainPID failure does not return the mismatch status"; else fail "non-MainPID failure does not return the mismatch status"; fi
# Malformed MainPID must fail closed without the mismatch status.
cat > "$WORK/state/systemctl-show" <<EOF
Id=plasma-kwin_wayland.service
ActiveState=active
SubState=running
MainPID=0
Type=dbus
BusName=org.kde.KWinWrapper
ExecStart={ path=$LAUNCHER ; ignore=no }
FragmentPath=/run/systemd/user/plasma-kwin_wayland.service
SourcePath=
EOF
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "malformed MainPID rejected without mismatch status" "MainPID"
if [[ "$VALID_EXIT" -ne 42 ]]; then pass "malformed MainPID does not return the mismatch status"; else fail "malformed MainPID does not return the mismatch status"; fi

# 10. Type/BusName mismatch rejected.
cat > "$WORK/state/systemctl-show" <<EOF
Id=plasma-kwin_wayland.service
ActiveState=active
SubState=running
MainPID=$PROC_PID
Type=simple
BusName=org.kde.KWinWrapper
ExecStart={ path=$LAUNCHER ; ignore=no }
FragmentPath=/run/systemd/user/plasma-kwin_wayland.service
SourcePath=
EOF
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "Type mismatch rejected" "Type"
cat > "$WORK/state/systemctl-show" <<EOF
Id=plasma-kwin_wayland.service
ActiveState=active
SubState=running
MainPID=$PROC_PID
Type=dbus
BusName=org.kde.Other
ExecStart={ path=$LAUNCHER ; ignore=no }
FragmentPath=/run/systemd/user/plasma-kwin_wayland.service
SourcePath=
EOF
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "BusName mismatch rejected" "BusName"

# 11. Active/Sub/Id mismatch rejected.
cat > "$WORK/state/systemctl-show" <<EOF
Id=plasma-kwin_wayland.service
ActiveState=inactive
SubState=running
MainPID=$PROC_PID
Type=dbus
BusName=org.kde.KWinWrapper
ExecStart={ path=$LAUNCHER ; ignore=no }
FragmentPath=/run/systemd/user/plasma-kwin_wayland.service
SourcePath=
EOF
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "inactive unit rejected" "not active"
cat > "$WORK/state/systemctl-show" <<EOF
Id=other.service
ActiveState=active
SubState=running
MainPID=$PROC_PID
Type=dbus
BusName=org.kde.KWinWrapper
ExecStart={ path=$LAUNCHER ; ignore=no }
FragmentPath=/run/systemd/user/plasma-kwin_wayland.service
SourcePath=
EOF
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "unit Id mismatch rejected" "Id mismatch"

# 12. Malformed boot ID rejected.
printf 'not-a-uuid\n' > "$WORK/proc/sys/kernel/random/boot_id"
write_show "$LAUNCHER"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "malformed boot ID rejected" "boot ID"
printf '%s\n' "$BOOT_ID" > "$WORK/proc/sys/kernel/random/boot_id"

# 13. SourcePath empty allowed; missing line and unsafe fragment rejected.
write_show "$LAUNCHER"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
if [[ "$VALID_EXIT" -eq 0 ]]; then pass "empty SourcePath allowed"; else fail "empty SourcePath allowed"; fi
grep -v '^SourcePath=' "$WORK/state/systemctl-show" > "$WORK/state/no-source"
cp "$WORK/state/no-source" "$WORK/state/systemctl-show"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "missing SourcePath rejected" "SourcePath"
write_show "$LAUNCHER"
sed -i 's|^FragmentPath=.*|FragmentPath=relative/path|' "$WORK/state/systemctl-show"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "unsafe FragmentPath rejected" "FragmentPath"

# 14. PROC_ROOT gate: non-/proc without flag fails closed.
write_show "$LAUNCHER"
set +e
SYSTEMCTL_BIN="$WORK/fakebin/systemctl" PROC_ROOT="$WORK/proc" \
  FAKE_ID_STATE="$WORK/state" \
  "$BASH_BIN" -c '. "$1"; poc3_kwin_systemd_fallback "$2" "$3" "$4"' _ "$TOOL" "$PROC_OWNER" "$PROC_PID" "$PROC_TICK" >"$OUTPUT" 2>&1
VALID_EXIT=$?
set -e
expect_fail_contains "non-proc without gate fails closed" "PROC_ROOT"

# 15. Owner/PID/tick format rejected.
write_show "$LAUNCHER"
run_helper "not-unique" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "non-unique owner rejected" "unique name"
run_helper "$PROC_OWNER" "0" "$PROC_TICK"
expect_fail_contains "zero PID rejected" "malformed"

# 16. Zombie start-tick never binds (matches trio/command/planner).
write_show "$LAUNCHER"
_zfields="Z"
for ((_k = 1; _k < 19; _k += 1)); do _zfields+=' 0'; done
_zfields+=" $PROC_TICK"
printf '%s (kwin_wayland) %s\n' "$PROC_PID" "$_zfields" > "$WORK/proc/$PROC_PID/stat"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "zombie tick refuses" "stale or unreadable"
write_stat_fresh() {
  local _f="S" _k
  for ((_k = 1; _k < 19; _k += 1)); do _f+=' 0'; done
  _f+=" $PROC_TICK"
  printf '%s (kwin_wayland) %s\n' "$PROC_PID" "$_f" > "$WORK/proc/$PROC_PID/stat"
}
write_stat_fresh

# 17. Mid-run PID reuse (tick changes during systemctl show) refuses.
write_show "$LAUNCHER"
cat > "$WORK/fakebin/systemctl-mutating" <<EOF
#!/usr/bin/env bash
set -uo pipefail
state="\${FAKE_ID_STATE:-}"
[[ -n "\$state" && -d "\$state" ]] || exit 1
_mf="S"
for ((_k = 1; _k < 19; _k += 1)); do _mf+=' 0'; done
_mf+=" 999999"
printf '%s (kwin_wayland) %s\n' "$PROC_PID" "\$_mf" > "$WORK/proc/$PROC_PID/stat"
cat "\$state/systemctl-show"
EOF
chmod +x "$WORK/fakebin/systemctl-mutating"
set +e
SYSTEMCTL_BIN="$WORK/fakebin/systemctl-mutating" PROC_ROOT="$WORK/proc" \
  POC3_KWIN_IDENTITY_TEST_ALLOW_NONPROC=1 POC3_KWIN_IDENTITY_TEST_ALLOW_NONSTORE=1 \
  FAKE_ID_STATE="$WORK/state" \
  "$BASH_BIN" -c '. "$1"; poc3_kwin_systemd_fallback "$2" "$3" "$4"' _ "$TOOL" "$PROC_OWNER" "$PROC_PID" "$PROC_TICK" >"$OUTPUT" 2>&1
VALID_EXIT=$?
set -e
expect_fail_contains "mid-run tick reuse refuses" "start-tick mismatch"
write_stat_fresh
write_show "$LAUNCHER"

# 18. Wrong launcher basename refused (exact /bin/kwin_wayland_wrapper only).
write_show "$WORK/pkg/bin/kwin_wayland"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "wrong launcher basename refuses" "wrapper-pair"
write_show "$WORK/pkg/bin/kwin_wayland_wrapper-extra"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "launcher suffix mismatch refuses" "wrapper-pair"
write_show "$LAUNCHER"

# 19. Arbitrary sibling as wrapped refused (wrapped file replaced by sibling).
mv "$WRAPPED" "$WORK/pkg/bin/wrapped-bak"
printf 'sibling-fixture\n' > "$WORK/pkg/bin/sibling"
chmod +x "$WORK/pkg/bin/sibling"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "missing wrapped (sibling only) refuses" "wrapper-pair"
rm -f "$WORK/pkg/bin/sibling"
mv "$WORK/pkg/bin/wrapped-bak" "$WRAPPED"

# 20. Different store package (cross-package symlink) refused.
mv "$WRAPPED" "$WORK/pkg/bin/wrapped-bak2"
ln -s "$OTHER_WRAPPED" "$WRAPPED"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "cross-package wrapped symlink refuses" "wrapper-pair"
rm -f "$WRAPPED"
mv "$WORK/pkg/bin/wrapped-bak2" "$WRAPPED"
mv "$LAUNCHER" "$WORK/pkg/bin/launcher-bak"
ln -s "$OTHER_LAUNCHER" "$LAUNCHER"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "cross-package launcher symlink refuses" "wrapper-pair"
rm -f "$LAUNCHER"
mv "$WORK/pkg/bin/launcher-bak" "$LAUNCHER"

# 21. Launcher or wrapped symlink/replacement refused.
mv "$LAUNCHER" "$WORK/pkg/bin/launcher-real"
ln -s "$WORK/pkg/bin/launcher-real" "$LAUNCHER"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "launcher symlink refuses" "wrapper-pair"
rm -f "$LAUNCHER"
mv "$WORK/pkg/bin/launcher-real" "$LAUNCHER"
mv "$WRAPPED" "$WORK/pkg/bin/wrapped-real"
ln -s "$WORK/pkg/bin/wrapped-real" "$WRAPPED"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "wrapped symlink refuses" "wrapper-pair"
rm -f "$WRAPPED"
mv "$WORK/pkg/bin/wrapped-real" "$WRAPPED"

# 22. Hash drift/replacement changes identity (receipt byte diff).
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
cp "$OUTPUT" "$WORK/good-identity.txt"
chmod u+w "$LAUNCHER"
printf 'tampered-launcher\n' > "$LAUNCHER"
chmod 555 "$LAUNCHER"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
if [[ "$VALID_EXIT" -eq 0 ]] && ! cmp -s "$WORK/good-identity.txt" "$OUTPUT"; then pass "launcher hash drift changes identity"; else fail "launcher hash drift changes identity"; cat "$OUTPUT" >&2; fi
chmod u+w "$LAUNCHER"
printf 'kwin-launcher-fixture\n' > "$LAUNCHER"
chmod 555 "$LAUNCHER"
chmod u+w "$WRAPPED"
printf 'tampered-wrapped\n' > "$WRAPPED"
chmod 555 "$WRAPPED"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
if [[ "$VALID_EXIT" -eq 0 ]] && ! cmp -s "$WORK/good-identity.txt" "$OUTPUT"; then pass "wrapped hash drift changes identity"; else fail "wrapped hash drift changes identity"; cat "$OUTPUT" >&2; fi
chmod u+w "$WRAPPED"
printf 'kwin-wrapped-fixture\n' > "$WRAPPED"
chmod 555 "$WRAPPED"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
if cmp -s "$WORK/good-identity.txt" "$OUTPUT"; then pass "restored pair revalidates"; else fail "restored pair revalidates"; cat "$OUTPUT" >&2; fi

# 23. Nonregular/nonexecutable/writable on both refused (stat mode, no writable bits).
chmod -x "$LAUNCHER"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "nonexecutable launcher refuses" "wrapper-pair"
chmod 555 "$LAUNCHER"
chmod -x "$WRAPPED"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "nonexecutable wrapped refuses" "wrapper-pair"
chmod 555 "$WRAPPED"
chmod 755 "$LAUNCHER"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "writable launcher mode refuses" "wrapper-pair"
chmod 555 "$LAUNCHER"
chmod 755 "$WRAPPED"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "writable wrapped mode refuses" "wrapper-pair"
chmod 555 "$WRAPPED"
chmod 644 "$LAUNCHER"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "writable non-exec launcher refuses" "wrapper-pair"
chmod 555 "$LAUNCHER"
rm -f "$LAUNCHER"
mkdir "$LAUNCHER"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "nonregular launcher refuses" "wrapper-pair"
rmdir "$LAUNCHER"
printf 'kwin-launcher-fixture\n' > "$LAUNCHER"
chmod 555 "$LAUNCHER"
rm -f "$WRAPPED"
mkdir "$WRAPPED"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "nonregular wrapped refuses" "wrapper-pair"
rmdir "$WRAPPED"
printf 'kwin-wrapped-fixture\n' > "$WRAPPED"
chmod 555 "$WRAPPED"

# 24. Inode drift (replacement file) refused via byte diff.
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
cp "$OUTPUT" "$WORK/good-identity2.txt"
rm -f "$WRAPPED"
printf 'kwin-wrapped-fixture\n' > "$WRAPPED"
chmod 555 "$WRAPPED"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
if cmp -s "$WORK/good-identity2.txt" "$OUTPUT"; then fail "wrapped inode replacement must change identity"; else pass "wrapped inode replacement changes identity"; fi

# 25. Same-path live proc mismatch: readable /proc/exe with differing
# hash/inode/mode fails closed even though canonical path agrees.
cp "$WRAPPED" "$WORK/proc-wrapped-copy"
chmod 555 "$WORK/proc-wrapped-copy"
rm -f "$WORK/proc/$PROC_PID/exe"
ln -s "$WORK/proc-wrapped-copy" "$WORK/proc/$PROC_PID/exe"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "same-path live proc hash/inode mismatch refuses" "disagrees"
rm -f "$WORK/proc/$PROC_PID/exe"
ln -s "$WRAPPED" "$WORK/proc/$PROC_PID/exe"
chmod 755 "$WRAPPED"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "same-path live proc mode mismatch refuses" "wrapper-pair"
chmod 555 "$WRAPPED"
rm -f "$WORK/proc/$PROC_PID/exe"

# 26. Pin revalidation: replacement drift between capture and revalidation
# refuses (wrapper replaced after first pin would change re-pin bytes).
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
cp "$OUTPUT" "$WORK/good-identity3.txt"
rm -f "$WRAPPED"
printf 'kwin-wrapped-fixture\n' > "$WRAPPED"
chmod 555 "$WRAPPED"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
if cmp -s "$WORK/good-identity3.txt" "$OUTPUT"; then fail "pin revalidation must observe replacement drift"; else pass "pin revalidation observes replacement drift"; fi

printf 'poc3-host-kwin-identity static: pass=%s fail=%s\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
