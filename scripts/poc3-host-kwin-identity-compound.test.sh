#!/usr/bin/env bash
# Focused synthetic compound coverage for scripts/poc3-host-kwin-identity.sh.
#
# No live execution: never touches host D-Bus, systemctl --user, or real
# /proc. All inputs are synthetic fixtures under a temp dir (fake systemctl
# shim, fake PROC_ROOT, fixture store files). Tests actual helper behavior
# via poc3_kwin_systemd_fallback exit codes and 14-line identity output, not
# mere string presence. D-Bus owner/PID/tick are caller-pinned inputs to the
# helper, so owner/PID drift is proven via receipt capture/revalidation
# (first 3 receipt lines) plus live tick re-pin behavior; no busctl fixture
# applies to this helper. Production parsers are not duplicated: revalidation
# uses whole-output diff, never a reimplemented ExecStart parser.
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
OTHER_WRAPPED="$OTHER_PKG_ROOT/bin/.kwin_wayland_wrapper-wrapped"
OTHER_LAUNCHER="$OTHER_PKG_ROOT/bin/kwin_wayland_wrapper"
PROC_PID="4242"
PROC_TICK="424200"
PROC_OWNER=":1.10"
BOOT_ID="12345678-1234-1234-1234-123456789abc"
BOOT_ID2="22222222-2222-2222-2222-222222222222"

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
  printf 'other-launcher\n' > "$OTHER_LAUNCHER"
  chmod 555 "$OTHER_LAUNCHER"
  printf 'other-wrapped\n' > "$OTHER_WRAPPED"
  chmod 555 "$OTHER_WRAPPED"
  write_stat "$PROC_PID" "$PROC_TICK"
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

write_stat() {
  local pid="$1" tick="$2"
  local fields="S" k
  for ((k = 1; k < 19; k += 1)); do fields+=' 0'; done
  fields+=" $tick"
  printf '%s (kwin_wayland) %s\n' "$pid" "$fields" > "$WORK/proc/$pid/stat"
}

write_show() {
  local exec_path="$1" mainpid="${2:-$PROC_PID}"
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

# Gated hermetic run: fake PROC_ROOT and non-store fixture paths allowed only
# via the explicit test gates below, never by default.
run_helper() {
  local owner="$1" pid="$2" tick="$3"
  set +e
  SYSTEMCTL_BIN="$WORK/fakebin/systemctl" PROC_ROOT="$WORK/proc" \
    POC3_KWIN_IDENTITY_TEST_ALLOW_NONPROC=1 POC3_KWIN_IDENTITY_TEST_ALLOW_NONSTORE=1 \
    FAKE_ID_STATE="$WORK/state" \
    "$BASH_BIN" -c '. "$1"; poc3_kwin_systemd_fallback "$2" "$3" "$4"' _ "$TOOL" "$owner" "$pid" "$tick" >"$OUTPUT" 2>&1
  VALID_EXIT=$?
  set -e
}

# Production-shaped run: non-store gate unset, so mutable/non-store ExecStart
# must fail closed even with the fake PROC_ROOT gate present.
run_helper_prod_store() {
  local owner="$1" pid="$2" tick="$3"
  set +e
  SYSTEMCTL_BIN="$WORK/fakebin/systemctl" PROC_ROOT="$WORK/proc" \
    POC3_KWIN_IDENTITY_TEST_ALLOW_NONPROC=1 FAKE_ID_STATE="$WORK/state" \
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

# Receipt: owner/pid/tick lines plus the 14-line helper identity. No parser
# duplication: revalidation diffs whole helper output.
capture_receipt() {
  local owner="$1" pid="$2" tick="$3" receipt="$4"
  run_helper "$owner" "$pid" "$tick"
  [[ "$VALID_EXIT" -eq 0 ]] || return 1
  { printf '%s\n%s\n%s\n' "$owner" "$pid" "$tick"; cat "$OUTPUT"; } > "$receipt"
}

# Revalidate: current owner/pid/tick must equal receipt pins, and a fresh
# helper run must byte-match the receipt identity (proves boot/unit drift
# refuses without reimplementing any production parser).
revalidate_receipt() {
  local receipt="$1" owner="$2" pid="$3" tick="$4"
  local r_owner r_pid r_tick
  r_owner="$(sed -n '1p' "$receipt")"
  r_pid="$(sed -n '2p' "$receipt")"
  r_tick="$(sed -n '3p' "$receipt")"
  [[ "$owner" == "$r_owner" ]] || { echo "owner drift: $owner != $r_owner" >&2; return 1; }
  [[ "$pid" == "$r_pid" ]] || { echo "pid drift: $pid != $r_pid" >&2; return 1; }
  [[ "$tick" == "$r_tick" ]] || { echo "tick drift: $tick != $r_tick" >&2; return 1; }
  run_helper "$owner" "$pid" "$tick"
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

# 1. Valid compound identity: 21 lines, pinned wrapper-pair fields agree.
rm -f "$WORK/proc/$PROC_PID/exe"
write_show "$LAUNCHER"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
exp_wsha="$(sha256sum -- "$WRAPPED" | awk '{print $1}')"
exp_wdev="$(stat -c '%d' -- "$WRAPPED")"
exp_wino="$(stat -c '%i' -- "$WRAPPED")"
exp_wmode="$(stat -c '%a' -- "$WRAPPED")"
exp_lsha="$(sha256sum -- "$LAUNCHER" | awk '{print $1}')"
exp_ldev="$(stat -c '%d' -- "$LAUNCHER")"
exp_lino="$(stat -c '%i' -- "$LAUNCHER")"
exp_lmode="$(stat -c '%a' -- "$LAUNCHER")"
if [[ "$VALID_EXIT" -eq 0 ]] && [[ "$(wc -l < "$OUTPUT")" -eq 21 ]] \
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
  && [[ "$(sed -n '16p' "$OUTPUT")" == "$PROC_PID" ]] \
  && [[ "$(sed -n '17p' "$OUTPUT")" == "dbus" ]] \
  && [[ "$(sed -n '18p' "$OUTPUT")" == "org.kde.KWinWrapper" ]] \
  && [[ "$(sed -n '19p' "$OUTPUT")" == "$LAUNCHER" ]]; then
  pass "valid compound identity pins wrapped/launcher/boot/hash/dev/ino/mode/unit"
else
  fail "valid compound identity pins wrapped/launcher/boot/hash/dev/ino/mode/unit"
  cat "$OUTPUT" >&2
fi
RECEIPT="$WORK/receipt.txt"
if capture_receipt "$PROC_OWNER" "$PROC_PID" "$PROC_TICK" "$RECEIPT"; then
  pass "receipt capture succeeds"
else
  fail "receipt capture succeeds"
fi
if revalidate_receipt "$RECEIPT" "$PROC_OWNER" "$PROC_PID" "$PROC_TICK" >"$REV" 2>&1; then pass "unchanged receipt revalidates"; else fail "unchanged receipt revalidates"; cat "$REV" >&2; fi

# 2. Wrong MainPID fails closed with no partial identity (fixed status only).
write_show "$LAUNCHER" "9999"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "wrong MainPID refuses" "MainPID"
if [[ "$VALID_EXIT" -eq 42 ]]; then pass "exact MainPID mismatch returns the fixed status"; else fail "exact MainPID mismatch returns the fixed status"; fi
write_show "$LAUNCHER"
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
expect_fail_contains "non-MainPID failure refuses" "Type"
if [[ "$VALID_EXIT" -ne 42 ]]; then pass "non-MainPID failure does not return the mismatch status"; else fail "non-MainPID failure does not return the mismatch status"; fi
write_show "$LAUNCHER"

# 3. Start-tick drift (unit restart shape) fails closed on re-pin.
write_show "$LAUNCHER"
write_stat "$PROC_PID" "999999"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "start-tick drift refuses" "start-tick mismatch"
if revalidate_receipt "$RECEIPT" "$PROC_OWNER" "$PROC_PID" "999999" >"$REV" 2>&1; then fail "receipt tick drift refuses"; else
  if grep -Fq "tick drift" "$REV"; then pass "receipt tick drift refuses"; else fail "receipt tick drift refuses"; cat "$REV" >&2; fi
fi
write_stat "$PROC_PID" "$PROC_TICK"

# 4. PID reuse shape: stat PID disagrees with requested PID.
printf '9999 (kwin_wayland) S 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 %s\n' "$PROC_TICK" > "$WORK/proc/$PROC_PID/stat"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "PID reuse (stat PID mismatch) refuses" "stale or unreadable"
write_stat "$PROC_PID" "$PROC_TICK"
if revalidate_receipt "$RECEIPT" "$PROC_OWNER" "4243" "$PROC_TICK" >"$REV" 2>&1; then fail "receipt PID drift refuses"; else
  if grep -Fq "pid drift" "$REV"; then pass "receipt PID drift refuses"; else fail "receipt PID drift refuses"; cat "$REV" >&2; fi
fi
if revalidate_receipt "$RECEIPT" ":1.11" "$PROC_PID" "$PROC_TICK" >"$REV" 2>&1; then fail "receipt owner drift refuses"; else
  if grep -Fq "owner drift" "$REV"; then pass "receipt owner drift refuses"; else fail "receipt owner drift refuses"; cat "$REV" >&2; fi
fi

# 5. Unit restart: new PID/tick/unit identity no longer matches receipt.
mkdir -p "$WORK/proc/4243"
write_stat "4243" "424300"
write_show "$LAUNCHER" "4243"
if revalidate_receipt "$RECEIPT" "$PROC_OWNER" "4243" "424300" >"$REV" 2>&1; then fail "unit restart (new PID/tick) refuses old receipt"; else pass "unit restart (new PID/tick) refuses old receipt"; fi
rm -rf "$WORK/proc/4243"
write_stat "$PROC_PID" "$PROC_TICK"
write_show "$LAUNCHER"

# 6. Inactive unit refuses (ActiveState and SubState).
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
expect_fail_contains "inactive ActiveState refuses" "not active"
cat > "$WORK/state/systemctl-show" <<EOF
Id=plasma-kwin_wayland.service
ActiveState=active
SubState=exited
MainPID=$PROC_PID
Type=dbus
BusName=org.kde.KWinWrapper
ExecStart={ path=$LAUNCHER ; ignore=no }
FragmentPath=/run/systemd/user/plasma-kwin_wayland.service
SourcePath=
EOF
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "non-running SubState refuses" "not running"

# 7. Mutable/non-store ExecStart refuses in production (gate unset).
write_show "/usr/bin/kwin_wayland_wrapper"
run_helper_prod_store "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "non-store /usr/bin refuses in production" "wrapper-pair"
write_show "/tmp/mutable-kwin_wrapper"
run_helper_prod_store "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "mutable /tmp ExecStart refuses in production" "wrapper-pair"

# 8. Multiple ExecStart commands refused.
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
expect_fail_contains "multiple ExecStart commands refuse" "ambiguous"

# 9. Property parse injection refuses: duplicate, unexpected, malformed, CR.
write_show "$LAUNCHER"
printf 'Id=plasma-kwin_wayland.service\n' >> "$WORK/state/systemctl-show"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "duplicate property refuses" "duplicate"
write_show "$LAUNCHER"
printf 'EvilProp=injected\n' >> "$WORK/state/systemctl-show"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "unexpected property refuses" "unexpected"
write_show "$LAUNCHER"
printf 'malformed-line-without-equals\n' >> "$WORK/state/systemctl-show"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "malformed property line refuses" "malformed"
write_show "$LAUNCHER"
printf 'SourcePath=\r\n' >> "$WORK/state/systemctl-show"
cp "$WORK/state/systemctl-show" "$WORK/state/cr-show"
printf 'Id=plasma-kwin_wayland.service\r\n' > "$WORK/state/systemctl-show"
cat "$WORK/state/cr-show" >> "$WORK/state/systemctl-show"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "CR-injected reply refuses" "malformed"

# 10. Boot-ID drift: fresh identity differs, receipt revalidation refuses.
write_show "$LAUNCHER"
printf '%s\n' "$BOOT_ID" > "$WORK/proc/sys/kernel/random/boot_id"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
boot_before="$(sed -n '2p' "$OUTPUT")"
printf '%s\n' "$BOOT_ID2" > "$WORK/proc/sys/kernel/random/boot_id"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
boot_after="$(sed -n '2p' "$OUTPUT")"
if [[ "$VALID_EXIT" -eq 0 && "$boot_before" == "$BOOT_ID" && "$boot_after" == "$BOOT_ID2" && "$boot_before" != "$boot_after" ]]; then
  pass "boot-ID drift changes live identity"
else
  fail "boot-ID drift changes live identity"
  cat "$OUTPUT" >&2
fi
if revalidate_receipt "$RECEIPT" "$PROC_OWNER" "$PROC_PID" "$PROC_TICK" >"$REV" 2>&1; then fail "receipt boot drift refuses"; else
  if grep -Fq "identity drift" "$REV"; then pass "receipt boot drift refuses"; else fail "receipt boot drift refuses"; cat "$REV" >&2; fi
fi
printf '%s\n' "$BOOT_ID" > "$WORK/proc/sys/kernel/random/boot_id"

# 11. Readable /proc/exe disagreement fails closed; unit drift vs receipt.
write_show "$LAUNCHER"
rm -f "$WORK/proc/$PROC_PID/exe"
ln -s "$OTHER_FILE" "$WORK/proc/$PROC_PID/exe"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "readable sibling /proc/exe refuses" "disagrees"
rm -f "$WORK/proc/$PROC_PID/exe"
ln -s "$LAUNCHER" "$WORK/proc/$PROC_PID/exe"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "readable launcher-only MainPID refuses" "disagrees"
rm -f "$WORK/proc/$PROC_PID/exe"
ln -s "$OTHER_WRAPPED" "$WORK/proc/$PROC_PID/exe"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "readable cross-package wrapped refuses" "disagrees"
rm -f "$WORK/proc/$PROC_PID/exe"
write_show "$LAUNCHER" "9999"
if revalidate_receipt "$RECEIPT" "$PROC_OWNER" "$PROC_PID" "$PROC_TICK" >"$REV" 2>&1; then fail "receipt unit (MainPID) drift refuses"; else pass "receipt unit (MainPID) drift refuses"; fi
write_show "$LAUNCHER"

# 12. Wrapper-pair hardening: wrong basenames, cross-package, symlink, perms.
write_show "$WORK/pkg/bin/kwin_wayland"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "wrong launcher basename refuses" "wrapper-pair"
write_show "$LAUNCHER"
mv "$WRAPPED" "$WORK/pkg/bin/wrapped-bak"
printf 'sibling\n' > "$WORK/pkg/bin/sibling"
chmod 555 "$WORK/pkg/bin/sibling"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "arbitrary sibling (missing wrapped) refuses" "wrapper-pair"
rm -f "$WORK/pkg/bin/sibling"
mv "$WORK/pkg/bin/wrapped-bak" "$WRAPPED"
mv "$WRAPPED" "$WORK/pkg/bin/wrapped-bak2"
ln -s "$OTHER_WRAPPED" "$WRAPPED"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "different store package symlink refuses" "wrapper-pair"
rm -f "$WRAPPED"
mv "$WORK/pkg/bin/wrapped-bak2" "$WRAPPED"
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
chmod -x "$LAUNCHER"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "nonexecutable launcher refuses" "wrapper-pair"
chmod 555 "$LAUNCHER"
chmod -x "$WRAPPED"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "nonexecutable wrapped refuses" "wrapper-pair"
chmod 555 "$WRAPPED"
rm -f "$LAUNCHER"
mkdir "$LAUNCHER"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "nonregular launcher refuses" "wrapper-pair"
rmdir "$LAUNCHER"
printf 'kwin-launcher-fixture\n' > "$LAUNCHER"
chmod 555 "$LAUNCHER"
chmod u+w "$WRAPPED"
printf 'tampered\n' > "$WRAPPED"
chmod 555 "$WRAPPED"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
if [[ "$VALID_EXIT" -eq 0 ]] && ! cmp -s "$RECEIPT" <( { printf '%s\n%s\n%s\n' "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"; cat "$OUTPUT"; } ); then pass "wrapped hash drift changes identity"; else fail "wrapped hash drift changes identity"; cat "$OUTPUT" >&2; fi
chmod u+w "$WRAPPED"
printf 'kwin-wrapped-fixture\n' > "$WRAPPED"
chmod 555 "$WRAPPED"

# 13. Mode writable refusal plus live proc hash/inode/mode mismatch and pin revalidation.
chmod 755 "$LAUNCHER"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "writable launcher mode refuses" "wrapper-pair"
chmod 555 "$LAUNCHER"
chmod 755 "$WRAPPED"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "writable wrapped mode refuses" "wrapper-pair"
chmod 555 "$WRAPPED"
cp "$WRAPPED" "$WORK/proc-wrapped-copy"
chmod 555 "$WORK/proc-wrapped-copy"
rm -f "$WORK/proc/$PROC_PID/exe"
ln -s "$WORK/proc-wrapped-copy" "$WORK/proc/$PROC_PID/exe"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
expect_fail_contains "same-path live proc hash/inode mismatch refuses" "disagrees"
rm -f "$WORK/proc/$PROC_PID/exe"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
cp "$OUTPUT" "$WORK/good-compound.txt"
rm -f "$WRAPPED"
printf 'kwin-wrapped-fixture\n' > "$WRAPPED"
chmod 555 "$WRAPPED"
run_helper "$PROC_OWNER" "$PROC_PID" "$PROC_TICK"
if cmp -s "$WORK/good-compound.txt" "$OUTPUT"; then fail "pin revalidation must observe replacement drift"; else pass "pin revalidation observes replacement drift"; fi

printf 'poc3-host-kwin-identity-compound static: pass=%s fail=%s\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
