#!/usr/bin/env bash
# Focused hermetic test for scripts/route-diag-follow.sh.
#
# Uses a fake journalctl/grep environment: asserts the script reads the full
# current-user current-boot journal (`journalctl --user -b`, no `-u`
# restriction so the unit-less tray autostart is included) while documenting
# the KWin/Planner source units, filters with fixed strings on the anchor so
# visible output is exclusively anchored project records from KWin, Planner,
# and tray together, validates/quotes --corr/--gen, supports --no-pointer
# suppression, and never invokes any activation verb
# (dbus, systemctl, busctl, qdbus, gdbus, activate, enable, start).
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/route-diag-follow.sh"
FAKE_BIN="$(mktemp -d)"
WORK="$(mktemp -d)"
PASS=0
FAIL=0

cleanup() {
  rm -rf "$FAKE_BIN" "$WORK"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  FAIL=$((FAIL + 1))
}

pass() {
  PASS=$((PASS + 1))
}

make_fake_tools() {
  mkdir -p "$FAKE_BIN/bin"
  local real_grep
  real_grep="$(command -v grep)"
  cat > "$FAKE_BIN/bin/journalctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "$FAKE_STATE_DIR/journalctl-args"
cat "$FAKE_STATE_DIR/journal-lines"
EOF
  cat > "$FAKE_BIN/bin/grep" <<EOF
#!/usr/bin/env bash
set -euo pipefail
printf 'grep %s\n' "\$*" >> "\$FAKE_STATE_DIR/grep-calls"
exec "$real_grep" "\$@"
EOF
  chmod +x "$FAKE_BIN/bin/journalctl" "$FAKE_BIN/bin/grep"
}

reset_state() {
  rm -rf "$WORK/state"
  mkdir -p "$WORK/state"
  export FAKE_STATE_DIR="$WORK/state"
  : > "$WORK/state/grep-calls"
  printf '%s\n' \
    'plasma-auto-tiler:route-diag:req:corr=gen-1-f0:rev=3' \
    'plasma-auto-tiler:route-diag:ptr:transition=coalesced:count=50' \
    'plasma-auto-tiler:route-diag:lifecycle:comp=tray:event=started:gen=packaged-rust-1' \
    'unrelated line without anchor' > "$WORK/state/journal-lines"
}

run_script() {
  JOURNALCTL_BIN="$FAKE_BIN/bin/journalctl" GREP_BIN="$FAKE_BIN/bin/grep" \
    bash "$SCRIPT" "$@" 2>"$WORK/state/stderr"
}

# 1. Code (non-comment) lines never invoke activation verbs. Mentions in
# comments are documentation, not invocations.
code_lines="$(grep -v -- '^[[:space:]]*#' "$SCRIPT")"
for verb in dbus systemctl busctl qdbus gdbus; do
  if printf '%s\n' "$code_lines" | grep -F -q -- "$verb"; then
    fail "script code mentions forbidden verb: $verb"
  else
    pass
  fi
done
# Activation verbs must not appear as commands (prose lives only in
# comments, which were stripped above).
if printf '%s\n' "$code_lines" | grep -w -E -q -- 'systemctl|busctl|qdbus|gdbus|dbus-send|dbus-monitor'; then
  fail "script invokes an activation command"
else
  pass
fi

make_fake_tools

# 2. Snapshot reads the full current-user current-boot journal with no -u
# restriction (tray autostart has no committed unit), no -f.
reset_state
output="$(run_script)"
expected_args="--user
-b"
actual_args="$(cat "$WORK/state/journalctl-args")"
if [[ "$actual_args" == "$expected_args" ]]; then
  pass
else
  fail "snapshot journalctl args mismatch, got: $actual_args"
fi
# No unit restriction may remain in the actual invocation (code lines only;
# unit names survive as documented source metadata, not flags).
if grep -q -- '^-u$' "$WORK/state/journalctl-args"; then
  fail "snapshot must not restrict units (tray has no unit): $(cat "$WORK/state/journalctl-args")"
else
  pass
fi
# Anchor-only filtering keeps the KWin, Planner, and tray diag lines
# together, drops the unrelated one: visible output is exclusively anchored.
if [[ "$output" == *"corr=gen-1-f0"* && "$output" == *":ptr:"* && "$output" == *"lifecycle"* && "$output" != *"unrelated"* ]]; then
  pass
else
  fail "snapshot anchor filtering wrong: $output"
fi
# Exactly the three anchored lines survive (no unrelated visible output).
if [[ "$(printf '%s\n' "$output" | grep -c -- 'plasma-auto-tiler:route-diag')" == 3 ]]; then
  pass
else
  fail "snapshot visible output is not exactly the anchored records: $output"
fi
# Every grep invocation uses fixed strings.
if grep -F -q -- ' -F ' "$WORK/state/grep-calls" && ! grep -q -- ' -E ' "$WORK/state/grep-calls"; then
  pass
else
  fail "grep calls are not all fixed-string: $(cat "$WORK/state/grep-calls")"
fi

# 3. --follow adds exactly -f and keeps the full boot/user scope with no
# unit restriction (tray inclusion).
reset_state
run_script --follow > /dev/null
if grep -q -- '^-f$' "$WORK/state/journalctl-args" \
  && grep -q -- '^--user$' "$WORK/state/journalctl-args" \
  && grep -q -- '^-b$' "$WORK/state/journalctl-args" \
  && ! grep -q -- '^-u$' "$WORK/state/journalctl-args"; then
  pass
else
  fail "follow journalctl args wrong: $(cat "$WORK/state/journalctl-args")"
fi
# Documented source units still agree with the Rust viewer constants.
if grep -F -q -- 'plasma-kwin_wayland.service' "$SCRIPT" \
  && grep -F -q -- 'plasma-auto-tiler-planner.service' "$SCRIPT"; then
  pass
else
  fail "follow script must document the KWin/Planner source units"
fi

# 4. --corr/--gen filter with validated quoting; invalid tokens rejected.
reset_state
output="$(run_script --corr gen-1-f0)"
if [[ "$output" == *"corr=gen-1-f0"* && "$output" != *":ptr:"* && "$output" != *"lifecycle"* ]]; then
  pass
else
  fail "corr filtering wrong: $output"
fi
reset_state
output="$(run_script --gen packaged-rust-1)"
if [[ "$output" == *"lifecycle"* && "$output" != *"corr=gen-1-f0"* ]]; then
  pass
else
  fail "gen filtering wrong: $output"
fi
reset_state
if run_script --corr 'bad corr!!' > /dev/null 2>&1; then
  fail "invalid corr token was accepted"
else
  pass
fi
reset_state
if run_script --gen 'HAS_CAPS' > /dev/null 2>&1; then
  fail "invalid gen token was accepted"
else
  pass
fi
# Injection-shaped tokens never reach journalctl as flags.
reset_state
if run_script --corr '-u' > /dev/null 2>&1; then
  fail "flag-shaped corr token was accepted"
else
  pass
fi

# 5. --no-pointer suppresses only the coalesced pointer summary lines.
reset_state
output="$(run_script --no-pointer)"
if [[ "$output" != *":ptr:"* && "$output" == *"corr=gen-1-f0"* && "$output" == *"lifecycle"* ]]; then
  pass
else
  fail "no-pointer filtering wrong: $output"
fi
if grep -F -q -- ':ptr:' "$WORK/state/grep-calls"; then
  pass
else
  fail "no-pointer suppression pattern missing from grep calls"
fi

# 6. Unknown flags fail closed without invoking the journal.
reset_state
rm -f "$WORK/state/journalctl-args"
if run_script --bogus > /dev/null 2>&1; then
  fail "unknown flag was accepted"
else
  pass
fi
if [[ -f "$WORK/state/journalctl-args" ]]; then
  fail "journal was invoked despite rejected flags"
else
  pass
fi

# 7. Source/viewer agreement: the follow script documents exactly the units
# named by the Rust viewer constants and reads the full current-boot user
# journal anchor-filtered (no `-u` flags, so tray is included); the planner
# unit agrees (by base name, the Home Manager service key carries no
# `.service` suffix) with the Home Manager background service, which
# explicitly retains stdout/stderr in the journal; the KWin unit agrees with
# the documented live-testing unit. The `route-diag` status names the same
# units plus the unit-less tray source.
if grep -F -q -- 'plasma-auto-tiler-planner.service' "$REPO_ROOT/src/route_diag.rs" \
  && grep -F -q -- 'plasma-auto-tiler-planner' "$REPO_ROOT/home-manager-module.nix" \
  && grep -F -q -- 'plasma-auto-tiler-planner.service' "$SCRIPT"; then
  pass
else
  fail "planner unit agreement missing across module/viewer/follow script"
fi
if grep -F -q -- 'plasma-kwin_wayland.service' "$REPO_ROOT/src/route_diag.rs" \
  && grep -F -q -- 'plasma-kwin_wayland.service' "$SCRIPT" \
  && grep -F -q -- 'plasma-kwin_wayland.service' "$REPO_ROOT/docs/live-kwin-testing.md"; then
  pass
else
  fail "kwin unit agreement missing across viewer/follow script/docs"
fi
# Invocation carries no `-u` unit flags in code (comments may document the
# units); anchor filtering is what keeps visible output exclusively project
# records.
code_args_line="$(grep -F -- 'journal_args=' "$SCRIPT")"
if [[ "$code_args_line" == 'journal_args=(--user -b)' ]]; then
  pass
else
  fail "follow script must invoke the full boot/user journal, got: $code_args_line"
fi
if grep -F -q -- 'StandardOutput' "$REPO_ROOT/home-manager-module.nix" \
  && grep -F -q -- 'StandardError' "$REPO_ROOT/home-manager-module.nix"; then
  pass
else
  fail "planner service must explicitly retain stdout/stderr in the journal"
fi
# 8. Status/viewer consistency: `route-diag` status names the anchor, both
# source units, the unit-less tray source, and the exact full-journal
# anchor-filtered follow invocation.
if grep -F -q -- 'journalctl --user -b | grep -F' "$REPO_ROOT/src/route_diag.rs" \
  && grep -F -q -- 'tray (autostart, no unit)' "$REPO_ROOT/src/route_diag.rs"; then
  pass
else
  fail "route-diag status must name the full-journal follow plus the tray source"
fi

printf 'route-diag-follow: PASS=%d FAIL=%d\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
