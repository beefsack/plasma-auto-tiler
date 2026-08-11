#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/start-test.sh"
CONTROLLER="$REPO_ROOT/kwin/src/controller.ts"
FAKE_BIN="$(mktemp -d)"
WORK="$(mktemp -d)"
OUTPUT="$(mktemp)"
PASS=0
FAIL=0
EXIT=0

cleanup() {
  rm -rf "$FAKE_BIN"
  rm -rf "$WORK"
  rm -f "$OUTPUT"
}
trap cleanup EXIT

make_fake_tools() {
  mkdir -p "$FAKE_BIN/bin"
  printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$FAKE_BIN/bin/npm"
  printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\\n" "2517 /nix/store/kwin-6.7.3/bin/kwin_wayland --wayland-fd 7 --socket wayland-0"' > "$FAKE_BIN/bin/pgrep"
  printf '%s\n' '#!/usr/bin/env bash' 'if [[ "$*" == *"--show-cursor"* ]]; then' '  cat "$FAKE_JOURNAL_CURSOR"' 'else' '  cat "$FAKE_JOURNAL_READ"' 'fi' > "$FAKE_BIN/bin/journalctl"
  cat > "$FAKE_BIN/bin/busctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state="${FAKE_STATE_DIR:?}"
case "$*" in
  *isScriptLoaded*)
    if [[ -f "$state/loaded-malformed" ]]; then
      printf '{"type":"b","data":[true,false]}\n'
    elif [[ -f "$state/loaded" ]]; then
      printf '{"type":"b","data":[%s]}\n' "$(cat "$state/loaded")"
    else
      printf '{"type":"b","data":[false]}\n'
    fi ;;
  *introspect*)
    if [[ "$*" == *"/kglobalaccel"* ]]; then
      if [[ -f "$state/introspect-no-setter" ]]; then
        printf '[{"type":"interface","name":"org.kde.KGlobalAccel"}]\n'
      else
        printf '[{"type":"interface","name":"org.kde.KGlobalAccel"},{"name":".setShortcutKeys","type":"method","signature":"asa(ai)u","result_value":"a(ai)"}]\n'
      fi
    else
      printf '[{"type":"interface","name":"org.kde.kwin.Script"}]\n'
    fi ;;
  *unloadScript*)
    if [[ -f "$state/unload-fails" ]]; then
      printf '{"type":"b","data":[false]}\n'
    else
      printf 'false\n' > "$state/loaded"
      printf '{"type":"b","data":[true]}\n'
    fi ;;
  *loadScript*)
    if [[ -f "$state/load-malformed" ]]; then
      printf '{"type":"i","data":["not-an-int"]}\n'
    else
      printf '{"type":"i","data":[7]}\n'
    fi ;;
  *setShortcutKeys*)
    args=("$@")
    action_index=-1
    for index in "${!args[@]}"; do
      if [[ "${args[$index]}" == "plasma-auto-tiler-"* ]]; then
        action_index="$index"
        break
      fi
    done
    action="${args[$action_index]}"
    outer_count="${args[$((action_index + 3))]}"
    call_count=0
    [[ -f "$state/setshortcut-count" ]] && call_count="$(cat "$state/setshortcut-count")"
    call_count=$((call_count + 1))
    printf '%s\n' "$call_count" > "$state/setshortcut-count"
    key="${args[$((action_index + 5))]:-empty}"
    printf '%s %s\n' "$action" "$key" >> "${FAKE_CALL_LOG:?}"
    fails=false
    if [[ -f "$state/setshortcut-fails" ]]; then
      fails=true
    elif [[ -f "$state/setshortcut-fails-on" && "$call_count" -eq "$(cat "$state/setshortcut-fails-on")" ]]; then
      fails=true
    elif [[ -f "$state/setshortcut-fails-after" && "$call_count" -gt "$(cat "$state/setshortcut-fails-after")" ]]; then
      fails=true
    fi
    if [[ "$fails" == false ]]; then
      if [[ "$outer_count" == 0 ]]; then
        keys='[]'
        key=empty
      else
        key="${args[$((action_index + 5))]}"
        keys="[$key]"
      fi
      if [[ -f "$state/shortcuts" ]]; then
        jq --arg a "$action" --argjson k "$keys" \
          '(.data[0] | map(if .[0] == $a then .[6] = $k else . end)) as $rows | {type:"a(ssssssaiai)", data:[$rows]}' \
          "$state/shortcuts" > "$state/shortcuts.tmp" && mv "$state/shortcuts.tmp" "$state/shortcuts"
      fi
      printf '{"type":"a(ai)","data":[[[[%s,0,0,0]]]]}\n' "$key"
    else
      printf '{"type":"a(ai)","data":[[]]}\n'
    fi ;;
  *org.kde.kwin.Script\ run)
    printf 'ok\n' ;;
  *allComponents*)
    if [[ -f "$state/components" ]]; then
      cat "$state/components"
    else
      printf '{"type":"ao","data":[["/component/kwin"]]}\n'
    fi ;;
  *allShortcutInfos*)
    if [[ -f "$state/shortcuts" ]]; then
      if [[ -f "$state/wrong-owner" ]]; then
        jq '(.data[0] | map(if .[0] | startswith("plasma-auto-tiler-") then .[2] = "not-kwin" else . end)) as $rows | {type:"a(ssssssaiai)", data:[$rows]}' "$state/shortcuts"
      else
        cat "$state/shortcuts"
      fi
    else
      printf '{"type":"a(ssssssaiai)","data":[[]]}\n'
    fi ;;
  *)
    exit 1 ;;
esac
EOF
  chmod +x "$FAKE_BIN/bin/npm" "$FAKE_BIN/bin/pgrep" "$FAKE_BIN/bin/busctl" "$FAKE_BIN/bin/journalctl"
}

setup_state() {
  rm -rf "$WORK/state"
  mkdir -p "$WORK/state"
  printf '%s\n' "$1" > "$WORK/cursor"
  printf '%s' "$2" > "$WORK/journal_read"
}

run_script() {
  set +e
  FAKE_STATE_DIR="$WORK/state" FAKE_JOURNAL_CURSOR="$WORK/cursor" FAKE_JOURNAL_READ="$WORK/journal_read" \
    FAKE_CALL_LOG="$WORK/setshortcut.log" PATH="$FAKE_BIN/bin:$PATH" bash "$SCRIPT" "$@" >"$OUTPUT" 2>&1
  EXIT=$?
  set -e
}

check_exit() {
  local expected="$1"
  if [[ "$EXIT" -ne "$expected" ]]; then
    echo "FAIL: expected exit $expected, got $EXIT" >&2
    echo "--- output ---" >&2
    cat "$OUTPUT" >&2
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
}

assert_contains() {
  local needle="$1"
  if grep -Fq "$needle" "$OUTPUT"; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: output does not contain '$needle'" >&2
    echo "--- output ---" >&2
    cat "$OUTPUT" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_not_contains() {
  local needle="$1"
  if grep -Fq "$needle" "$OUTPUT"; then
    echo "FAIL: output unexpectedly contains '$needle'" >&2
    echo "--- output ---" >&2
    cat "$OUTPUT" >&2
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
}

assert_no_setshortcut_calls() {
  if [[ -s "$WORK/setshortcut.log" ]]; then
    echo "FAIL: unexpected setShortcutKeys calls made" >&2
    cat "$WORK/setshortcut.log" >&2
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
}

assert_only_project_setshortcut_calls() {
  if grep -Ev '^plasma-auto-tiler-' "$WORK/setshortcut.log" >/dev/null 2>&1; then
    echo "FAIL: setter called for an unrelated action" >&2
    cat "$WORK/setshortcut.log" >&2
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
}

TEST_RECORDS='{"type":"a(ssssssaiai)","data":[[["plasma-auto-tiler-focus-left","Focus window left","kwin","KWin","default","Default Context",[402653256],[]],["plasma-auto-tiler-move-up","Move window up","kwin","KWin","default","Default Context",[436207691],[]],["plasma-auto-tiler-detach","Detach window from tile","kwin","KWin","default","Default Context",[301989920],[]],["plasma-auto-tiler-apply-columns","Apply columns in focused leaf","kwin","KWin","default","Default Context",[402653233],[]],["KrohnkiteNextLayout","Krohnkite: Next Layout","kwin","KWin","default","Default Context",[268435548],[]]]]}'
READY_JOURNAL='{"MESSAGE":"plasma-auto-tiler:shortcut-registered"}
{"MESSAGE":"plasma-auto-tiler:startup-handlers-ready"}'

# Eight project records carrying stale Meta+Alt assignments, plus five records
# that already match the source defaults. Active field is the first integer
# array, default field the second.
RECONCILE_MISMATCH_RECORDS='{"type":"a(ssssssaiai)","data":[[["plasma-auto-tiler-focus-left","Focus window left","kwin","KWin","default","Default Context",[402653256],[]],["plasma-auto-tiler-focus-down","Focus window down","kwin","KWin","default","Default Context",[402653258],[]],["plasma-auto-tiler-focus-up","Focus window up","kwin","KWin","default","Default Context",[402653259],[]],["plasma-auto-tiler-focus-right","Focus window right","kwin","KWin","default","Default Context",[402653260],[]],["plasma-auto-tiler-move-left","Move window left","kwin","KWin","default","Default Context",[436207688],[]],["plasma-auto-tiler-move-down","Move window down","kwin","KWin","default","Default Context",[436207690],[]],["plasma-auto-tiler-move-up","Move window up","kwin","KWin","default","Default Context",[436207691],[]],["plasma-auto-tiler-move-right","Move window right","kwin","KWin","default","Default Context",[436207692],[]],["plasma-auto-tiler-insert-right","Insert next window right of focused leaf","kwin","KWin","default","Default Context",[419430420],[]],["plasma-auto-tiler-detach","Detach window from tile","kwin","KWin","default","Default Context",[301989920],[]],["plasma-auto-tiler-apply-columns","Apply columns in focused leaf","kwin","KWin","default","Default Context",[402653233],[]],["plasma-auto-tiler-apply-rows","Apply rows in focused leaf","kwin","KWin","default","Default Context",[402653234],[]],["plasma-auto-tiler-apply-balanced-grid","Apply balanced grid in focused leaf","kwin","KWin","default","Default Context",[402653235],[]]]]}'

RECONCILE_MATCHED_RECORDS='{"type":"a(ssssssaiai)","data":[[["plasma-auto-tiler-focus-left","Focus window left","kwin","KWin","default","Default Context",[268435528],[]],["plasma-auto-tiler-focus-down","Focus window down","kwin","KWin","default","Default Context",[268435530],[]],["plasma-auto-tiler-focus-up","Focus window up","kwin","KWin","default","Default Context",[268435531],[]],["plasma-auto-tiler-focus-right","Focus window right","kwin","KWin","default","Default Context",[469762124],[]],["plasma-auto-tiler-move-left","Move window left","kwin","KWin","default","Default Context",[301989960],[]],["plasma-auto-tiler-move-down","Move window down","kwin","KWin","default","Default Context",[301989962],[]],["plasma-auto-tiler-move-up","Move window up","kwin","KWin","default","Default Context",[301989963],[]],["plasma-auto-tiler-move-right","Move window right","kwin","KWin","default","Default Context",[301989964],[]],["plasma-auto-tiler-insert-right","Insert next window right of focused leaf","kwin","KWin","default","Default Context",[419430420],[]],["plasma-auto-tiler-detach","Detach window from tile","kwin","KWin","default","Default Context",[301989920],[]],["plasma-auto-tiler-apply-columns","Apply columns in focused leaf","kwin","KWin","default","Default Context",[402653233],[]],["plasma-auto-tiler-apply-rows","Apply rows in focused leaf","kwin","KWin","default","Default Context",[402653234],[]],["plasma-auto-tiler-apply-balanced-grid","Apply balanced grid in focused leaf","kwin","KWin","default","Default Context",[402653235],[]]]]}'

make_fake_tools

# start: successful readiness
setup_state '-- cursor: cursor-1' "$READY_JOURNAL"
run_script start
check_exit 0
assert_contains "controller readiness confirmed"
assert_contains "started:"

# start: disabled readiness fails closed
setup_state '-- cursor: cursor-1' '{"MESSAGE":"plasma-auto-tiler:disabled:shortcut-registration-failed"}'
run_script start
check_exit 1
assert_contains "controller disabled itself during startup"
assert_not_contains "started:"

# start: missing readiness fails closed
setup_state '-- cursor: cursor-1' '{"MESSAGE":"plasma-auto-tiler:shortcut-registered"}'
run_script start
check_exit 1
assert_contains "was not confirmed"
assert_not_contains "started:"

# start: malformed loadScript reply fails closed and cleans up
setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/load-malformed"
run_script start
check_exit 1
assert_contains "loadScript reply is not a strict"

# start: malformed isScriptLoaded reply fails closed
setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/loaded-malformed"
run_script start
check_exit 1
assert_contains "unexpected isScriptLoaded reply"

# start: refuses when already loaded
setup_state '-- cursor: cursor-1' ""
printf 'true\n' > "$WORK/state/loaded"
run_script start
check_exit 1
assert_contains "already loaded"

# status: distinguishes loaded state, readiness evidence, and stale action records
setup_state '-- cursor: cursor-1' "$READY_JOURNAL"
printf '%s' "$TEST_RECORDS" > "$WORK/state/shortcuts"
run_script status
check_exit 0
assert_contains "plugin: plasma-auto-tiler-kwin"
assert_contains "loaded: not-loaded"
assert_contains "controller running/callbacks: not proven"
assert_contains "controller readiness diagnostics (same-KWin-PID journal evidence): observed"
assert_contains "project action records (KGlobalAccel): 4"
assert_contains "plasma-auto-tiler-focus-left"
assert_contains "plasma-auto-tiler-detach"
assert_contains "active \"402653256\""
assert_not_contains "KrohnkiteNextLayout"
assert_contains "do not prove live callbacks"
assert_contains "shortcut assignments: matched 2, drift 2, missing 9"
assert_contains "persisted shortcut assignments drift from controller source"

# status: malformed allComponents reply fails closed (never zero matches)
setup_state '-- cursor: cursor-1' ""
printf '{"type":"ao","data":["/component/kwin"]}\n' > "$WORK/state/components"
run_script status
check_exit 1
assert_contains "unexpected allComponents reply"

# status: malformed allShortcutInfos tuple fails closed
setup_state '-- cursor: cursor-1' ""
printf '{"type":"a(ssssssaiai)","data":[[["malformed","tuple"]]]}\n' > "$WORK/state/shortcuts"
run_script status
check_exit 1
assert_contains "unexpected allShortcutInfos reply"

# status: malformed journal output fails closed
setup_state '-- cursor: cursor-1' 'not json'
printf '%s' "$TEST_RECORDS" > "$WORK/state/shortcuts"
run_script status
check_exit 1
assert_contains "could not parse KWin readiness diagnostics"

# stop: exact unload, verifies not loaded, leaves stale records reported
setup_state '-- cursor: cursor-1' ""
printf 'true\n' > "$WORK/state/loaded"
printf '%s' "$TEST_RECORDS" > "$WORK/state/shortcuts"
run_script stop
check_exit 0
assert_contains "stop: plugin 'plasma-auto-tiler-kwin' unloaded"
assert_contains "project action records still registered in KGlobalAccel: 4"
assert_contains "does not roll back"
assert_contains "do not prove live callbacks"
grep -Fq "false" "$WORK/state/loaded" || {
  echo "FAIL: unload did not clear the loaded state" >&2
  FAIL=$((FAIL + 1))
}

# stop: idempotent when not loaded
setup_state '-- cursor: cursor-1' ""
printf '%s' "$TEST_RECORDS" > "$WORK/state/shortcuts"
run_script stop
check_exit 0
assert_contains "is not loaded"

# stop: unloadScript returning false fails closed
setup_state '-- cursor: cursor-1' ""
printf 'true\n' > "$WORK/state/loaded"
touch "$WORK/state/unload-fails"
run_script stop
check_exit 1
assert_contains "unloadScript returned false"

# stop: malformed isScriptLoaded reply fails closed
setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/loaded-malformed"
run_script stop
check_exit 1
assert_contains "unexpected isScriptLoaded reply"

# start/status/stop must never mutate shortcut records
assert_no_setshortcut_calls

# reconcile-shortcuts: read-only report on stale records never mutates
setup_state '-- cursor: cursor-1' ""
printf '%s' "$RECONCILE_MISMATCH_RECORDS" > "$WORK/state/shortcuts"
run_script reconcile-shortcuts
check_exit 0
assert_contains "reconcile-shortcuts: read-only report (no mutation)"
assert_contains "setShortcutKeys asa(ai)u -> a(ai)"
assert_contains "matched: 5"
assert_contains "mismatched: 8"
assert_contains 'action "plasma-auto-tiler-focus-left" active "402653256" expected "268435528"'
assert_contains 'action "plasma-auto-tiler-focus-right" active "402653260" expected "469762124"'
assert_contains "missing: 0"
assert_contains "unrelated target conflicts: 0"
assert_contains "run 'reconcile-shortcuts --apply'"
assert_no_setshortcut_calls

# reconcile-shortcuts: all records already matching reports nothing to write
setup_state '-- cursor: cursor-1' ""
printf '%s' "$RECONCILE_MATCHED_RECORDS" > "$WORK/state/shortcuts"
run_script reconcile-shortcuts
check_exit 0
assert_contains "matched: 13"
assert_contains "mismatched: 0"
assert_no_setshortcut_calls

# reconcile-shortcuts --apply: reports nothing to write when all match
setup_state '-- cursor: cursor-1' ""
printf '%s' "$RECONCILE_MATCHED_RECORDS" > "$WORK/state/shortcuts"
run_script reconcile-shortcuts --apply
check_exit 0
assert_contains "nothing to write"
assert_no_setshortcut_calls

# reconcile-shortcuts --apply: writes exactly the 8 mismatched records, verifies, touches nothing else
setup_state '-- cursor: cursor-1' ""
printf '%s' "$RECONCILE_MISMATCH_RECORDS" > "$WORK/state/shortcuts"
run_script reconcile-shortcuts --apply
check_exit 0
assert_contains "reconcile-shortcuts --apply: preflight passed"
assert_contains "before:"
assert_contains 'action "plasma-auto-tiler-focus-left" active "402653256" expected "268435528"'
assert_contains "touched 8, verified 8, unverified 0"
assert_contains 'action "plasma-auto-tiler-focus-left" active "268435528" (verified)'
assert_contains 'action "plasma-auto-tiler-move-right" active "301989964" (verified)'
grep -Fq "plasma-auto-tiler-focus-left 268435528" "$WORK/setshortcut.log" || {
  echo "FAIL: setShortcutKeys not called for focus-left with expected key" >&2
  FAIL=$((FAIL + 1))
}
grep -Fq "plasma-auto-tiler-move-right 301989964" "$WORK/setshortcut.log" || {
  echo "FAIL: setShortcutKeys not called for move-right with expected key" >&2
  FAIL=$((FAIL + 1))
}
grep -Fq "plasma-auto-tiler-focus-left 402653256" "$WORK/setshortcut.log" && {
  echo "FAIL: setShortcutKeys called with a stale key" >&2
  FAIL=$((FAIL + 1))
} || PASS=$((PASS + 1))
if [[ "$(wc -l < "$WORK/setshortcut.log")" -ne 8 ]]; then
  echo "FAIL: expected exactly 8 setShortcutKeys calls, got $(wc -l < "$WORK/setshortcut.log")" >&2
  FAIL=$((FAIL + 1))
else
  PASS=$((PASS + 1))
fi
assert_only_project_setshortcut_calls
CALL_BASELINE="$(wc -l < "$WORK/setshortcut.log")"

# reconcile-shortcuts: read-only report surfaces unrelated conflicts for targets
setup_state '-- cursor: cursor-1' ""
printf '%s' "$RECONCILE_MISMATCH_RECORDS" > "$WORK/state/shortcuts"
jq '.data[0] += [["KrohnkiteNextLayout","Krohnkite: Next Layout","kwin","KWin","default","Default Context",[268435528],[]]]' \
  "$WORK/state/shortcuts" > "$WORK/state/shortcuts.tmp" && mv "$WORK/state/shortcuts.tmp" "$WORK/state/shortcuts"
run_script reconcile-shortcuts
check_exit 0
assert_contains "unrelated target conflicts: 1"
assert_contains "KrohnkiteNextLayout"
assert_contains 'active "268435528"'

# reconcile-shortcuts: read-only report counts only target-claiming unrelated records
setup_state '-- cursor: cursor-1' ""
printf '%s' "$RECONCILE_MISMATCH_RECORDS" > "$WORK/state/shortcuts"
jq '.data[0] += [["KrohnkiteNextLayout","Krohnkite: Next Layout","kwin","KWin","default","Default Context",[268435548],[]]]' \
  "$WORK/state/shortcuts" > "$WORK/state/shortcuts.tmp" && mv "$WORK/state/shortcuts.tmp" "$WORK/state/shortcuts"
run_script reconcile-shortcuts
check_exit 0
assert_contains "unrelated target conflicts: 0"
assert_not_contains "KrohnkiteNextLayout"

# reconcile-shortcuts --apply: unrelated conflict blocks the write, no mutation
setup_state '-- cursor: cursor-1' ""
printf '%s' "$RECONCILE_MISMATCH_RECORDS" > "$WORK/state/shortcuts"
jq '.data[0] += [["KrohnkiteNextLayout","Krohnkite: Next Layout","kwin","KWin","default","Default Context",[268435528],[]]]' \
  "$WORK/state/shortcuts" > "$WORK/state/shortcuts.tmp" && mv "$WORK/state/shortcuts.tmp" "$WORK/state/shortcuts"
run_script reconcile-shortcuts --apply
check_exit 1
assert_contains "refusing to apply"
assert_contains "claimed by unrelated records"
if [[ "$(wc -l < "$WORK/setshortcut.log")" -ne "$CALL_BASELINE" ]]; then
  echo "FAIL: conflict-blocked apply still wrote shortcut records" >&2
  FAIL=$((FAIL + 1))
else
  PASS=$((PASS + 1))
fi

# reconcile-shortcuts: read-only report lists a missing project record
setup_state '-- cursor: cursor-1' ""
printf '%s' "$RECONCILE_MISMATCH_RECORDS" > "$WORK/state/shortcuts"
jq 'del(.data[0][3])' "$WORK/state/shortcuts" > "$WORK/state/shortcuts.tmp" && mv "$WORK/state/shortcuts.tmp" "$WORK/state/shortcuts"
run_script reconcile-shortcuts
check_exit 0
assert_contains 'missing: 1'
assert_contains 'action "plasma-auto-tiler-focus-right" has no persisted record'

# reconcile-shortcuts --apply: a missing project record blocks the write
setup_state '-- cursor: cursor-1' ""
printf '%s' "$RECONCILE_MISMATCH_RECORDS" > "$WORK/state/shortcuts"
jq 'del(.data[0][3])' "$WORK/state/shortcuts" > "$WORK/state/shortcuts.tmp" && mv "$WORK/state/shortcuts.tmp" "$WORK/state/shortcuts"
run_script reconcile-shortcuts --apply
check_exit 1
assert_contains "refusing to apply with 1 missing project action record"
if [[ "$(wc -l < "$WORK/setshortcut.log")" -ne "$CALL_BASELINE" ]]; then
  echo "FAIL: missing-record-blocked apply still wrote shortcut records" >&2
  FAIL=$((FAIL + 1))
else
  PASS=$((PASS + 1))
fi

# reconcile-shortcuts --apply: exact kwin ownership is required before writing
setup_state '-- cursor: cursor-1' ""
printf '%s' "$RECONCILE_MISMATCH_RECORDS" > "$WORK/state/shortcuts"
touch "$WORK/state/wrong-owner"
CALL_BASELINE="$(wc -l < "$WORK/setshortcut.log")"
run_script reconcile-shortcuts --apply
check_exit 1
assert_contains 'action "plasma-auto-tiler-focus-left" is under component "not-kwin", expected "kwin"'
assert_contains "refusing to apply with 13 project ownership error"
if [[ "$(wc -l < "$WORK/setshortcut.log")" -ne "$CALL_BASELINE" ]]; then
  echo "FAIL: wrong-owner apply still wrote shortcut records" >&2
  FAIL=$((FAIL + 1))
else
  PASS=$((PASS + 1))
fi

# reconcile-shortcuts --apply: malformed setter reply fails closed and restores the touched record
setup_state '-- cursor: cursor-1' ""
printf '%s' "$RECONCILE_MISMATCH_RECORDS" > "$WORK/state/shortcuts"
touch "$WORK/state/setshortcut-fails"
run_script reconcile-shortcuts --apply
check_exit 1
assert_contains "did not confirm expected key"
assert_contains "rollback: restoring 1 touched project assignment"
assert_contains "rollback: verified exact restoration of 1 touched project assignment"

# reconcile-shortcuts --apply: a partial setter failure restores only touched project records exactly
setup_state '-- cursor: cursor-1' ""
printf '%s' "$RECONCILE_MISMATCH_RECORDS" > "$WORK/state/shortcuts"
touch "$WORK/state/setshortcut-fails-on"
printf '2\n' > "$WORK/state/setshortcut-fails-on"
run_script reconcile-shortcuts --apply
check_exit 1
assert_contains 'setShortcutKeys reply for action "plasma-auto-tiler-focus-down"'
assert_contains "rollback: verified exact restoration of 2 touched project assignment"
if ! jq -e --argjson before "$RECONCILE_MISMATCH_RECORDS" '. == $before' "$WORK/state/shortcuts" >/dev/null; then
  echo "FAIL: partial failure did not restore the exact original project assignments" >&2
  FAIL=$((FAIL + 1))
else
  PASS=$((PASS + 1))
fi
assert_only_project_setshortcut_calls

# reconcile-shortcuts --apply: rollback failure is explicit and leaves no unrelated setter calls
setup_state '-- cursor: cursor-1' ""
printf '%s' "$RECONCILE_MISMATCH_RECORDS" > "$WORK/state/shortcuts"
printf '2\n' > "$WORK/state/setshortcut-fails-after"
run_script reconcile-shortcuts --apply
check_exit 1
assert_contains "rollback: restoration was not fully verified"
assert_contains 'rollback unverified: action "plasma-auto-tiler-focus-left"'
assert_only_project_setshortcut_calls

# reconcile-shortcuts: missing setter contract fails closed without mutation
setup_state '-- cursor: cursor-1' ""
printf '%s' "$RECONCILE_MISMATCH_RECORDS" > "$WORK/state/shortcuts"
touch "$WORK/state/introspect-no-setter"
CALL_BASELINE="$(wc -l < "$WORK/setshortcut.log")"
run_script reconcile-shortcuts
check_exit 1
assert_contains "setShortcutKeys is absent"
if [[ "$(wc -l < "$WORK/setshortcut.log")" -ne "$CALL_BASELINE" ]]; then
  echo "FAIL: setter-contract failure still wrote shortcut records" >&2
  FAIL=$((FAIL + 1))
else
  PASS=$((PASS + 1))
fi

# The lifecycle catalog must exactly cover the controller registrations/default strings.
while IFS=$'\t' read -r action sequence shortcut; do
  if ! grep -Fq "[$action]=\"$sequence\"" "$SCRIPT"; then
    echo "FAIL: lifecycle catalog lacks $action=$sequence" >&2
    FAIL=$((FAIL + 1))
  elif ! grep -A3 -F "\"$action\"" "$CONTROLLER" | grep -Fq "\"$shortcut\""; then
    echo "FAIL: controller registration lacks $action=$shortcut" >&2
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
done <<'EOF'
plasma-auto-tiler-insert-right	419430420	Meta+Alt+Right
plasma-auto-tiler-focus-left	268435528	Meta+H
plasma-auto-tiler-focus-down	268435530	Meta+J
plasma-auto-tiler-focus-up	268435531	Meta+K
plasma-auto-tiler-focus-right	469762124	Meta+Alt+Ctrl+L
plasma-auto-tiler-move-left	301989960	Meta+Shift+H
plasma-auto-tiler-move-down	301989962	Meta+Shift+J
plasma-auto-tiler-move-up	301989963	Meta+Shift+K
plasma-auto-tiler-move-right	301989964	Meta+Shift+L
plasma-auto-tiler-detach	301989920	Meta+Shift+Space
plasma-auto-tiler-apply-columns	402653233	Meta+Alt+1
plasma-auto-tiler-apply-rows	402653234	Meta+Alt+2
plasma-auto-tiler-apply-balanced-grid	402653235	Meta+Alt+3
EOF

# reconcile-shortcuts: unknown argument fails closed
setup_state '-- cursor: cursor-1' ""
run_script reconcile-shortcuts --bogus
check_exit 1
assert_contains "unknown reconcile-shortcuts argument"

# reconcile-shortcuts: too many arguments fail closed
setup_state '-- cursor: cursor-1' ""
run_script reconcile-shortcuts --apply extra
check_exit 1
assert_contains "takes at most one argument"

# strict parsing: unknown command and missing command fail
set +e
PATH="$FAKE_BIN/bin:$PATH" bash "$SCRIPT" bogus >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 1
assert_contains "unknown command"

set +e
PATH="$FAKE_BIN/bin:$PATH" bash "$SCRIPT" >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 1
assert_contains "missing command"

# strict parsing: extra arguments fail
set +e
PATH="$FAKE_BIN/bin:$PATH" bash "$SCRIPT" status extra >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 1
assert_contains "takes no arguments"

echo "passes: $PASS failures: $FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
