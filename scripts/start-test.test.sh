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
REAL_MKTEMP="$(command -v mktemp)"
REAL_SLEEP="$(command -v sleep)"

cleanup() {
  rm -rf "$FAKE_BIN"
  rm -rf "$WORK"
  rm -f "$OUTPUT"
}
trap cleanup EXIT

make_fake_tools() {
  mkdir -p "$FAKE_BIN/bin"
  cat > "$FAKE_BIN/bin/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *build-provenance* ]]; then
  outfile="${PROVENANCE_OUTFILE:-}"
  args=("$@")
  for ((i = 0; i < ${#args[@]}; i += 1)); do
    if [[ "${args[$i]}" == --prefix && -z "$outfile" ]]; then outfile="${args[$((i + 1))]}/dist/provenance/main.js"; fi
  done
  mkdir -p "${outfile%/*}"
  printf 'provenance bundle\n' > "$outfile.tmp"
  mv -n -- "$outfile.tmp" "$outfile"
fi
exit 0
EOF
  cat > "$FAKE_BIN/bin/pgrep" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state="${FAKE_STATE_DIR:?}"
count=0
[[ -f "$state/pgrep-count" ]] && count="$(cat "$state/pgrep-count")"
count=$((count + 1))
printf '%s\n' "$count" > "$state/pgrep-count"
printf '9999 /tmp/lookalike --wayland-fd 7 --socket wayland-0\n8888 /nix/store/other/bin/kwin_wayland --wayland-fd 8 --socket wayland-1\n'
EOF
  cat > "$FAKE_BIN/bin/readlink" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
  cat > "$FAKE_BIN/bin/mktemp" <<'EOF'
#!/usr/bin/env bash
if [[ -f "${FAKE_STATE_DIR:?}/evidence-mktemp-fails" && "$*" == *plasma-auto-tiler-start* ]]; then
  exit 1
fi
exec "${REAL_MKTEMP:?}" "$@"
EOF
  cat > "$FAKE_BIN/bin/sleep" <<'EOF'
#!/usr/bin/env bash
if [[ -f "${FAKE_STATE_DIR:?}/start-sleep-fails" ]]; then
  exit 1
fi
exec "${REAL_SLEEP:?}" "$@"
EOF
  cat > "$FAKE_BIN/bin/journalctl" <<'EOF'
#!/usr/bin/env bash
  if [[ "$*" == *"--show-cursor"* ]]; then
    cat "$FAKE_JOURNAL_CURSOR"
  elif [[ "$*" == *"--after-cursor"* ]]; then
    cat "${FAKE_JOURNAL_AFTER:?}"
    if [[ -n "${FAKE_CONTROLLER_MESSAGE:-}" ]]; then
      printf '{"_PID":"2517","MESSAGE":"%s"}\n' "$FAKE_CONTROLLER_MESSAGE"
    fi
  else
  cat "$FAKE_JOURNAL_READ"
fi
EOF
  cat > "$FAKE_BIN/bin/busctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state="${FAKE_STATE_DIR:?}"
case "$*" in
  *"GetNameOwner s org.kde.KWin"*)
    count=0
    [[ -f "$state/kwin-owner-count" ]] && count="$(cat "$state/kwin-owner-count")"
    count=$((count + 1))
    printf '%s\n' "$count" > "$state/kwin-owner-count"
    printf '{"type":"s","data":[":1.10"]}\n' ;;
  *"GetConnectionUnixProcessID s :1.10"*)
    pid=2517
    count=0
    [[ -f "$state/kwin-owner-count" ]] && count="$(cat "$state/kwin-owner-count")"
    if [[ "$count" -gt 1 && -f "$state/dbus-next-pid" ]]; then
      pid="$(cat "$state/dbus-next-pid")"
    fi
    start=251700
    if [[ -n "${FAKE_KWIN_IDENTITY_SEQUENCE:-}" ]]; then
      IFS=',' read -r -a identities <<<"$FAKE_KWIN_IDENTITY_SEQUENCE"
      index=$((count - 1))
      [[ "$index" -lt "${#identities[@]}" ]] && start="${identities[$index]}" || start="${identities[$((${#identities[@]} - 1))]}"
    fi
    mkdir -p "${FAKE_PROC_ROOT:?}/$pid"
    if [[ -f "$state/stat-unreadable" ]]; then
      rm -f "${FAKE_PROC_ROOT:?}/$pid/stat"
    elif [[ -f "$state/stat-malformed" ]]; then
      printf '%s (kwin_wayland) S 0\n' "$pid" > "${FAKE_PROC_ROOT:?}/$pid/stat"
    else
      fields=S
      for ((index = 1; index < 19; index += 1)); do fields+=' 0'; done
      fields+=" $start"
      printf '%s (kwin_wayland) %s\n' "$pid" "$fields" > "${FAKE_PROC_ROOT:?}/$pid/stat"
    fi
    printf '{"type":"u","data":[%s]}\n' "$pid" ;;
  *"GetNameOwner s org.kde.kglobalaccel"*)
    printf '{"type":"s","data":[":1.20"]}\n' ;;
  *"GetConnectionUnixProcessID s :1.20"*)
    if [[ -f "$state/kglobalaccel-pid-reply" ]]; then
      cat "$state/kglobalaccel-pid-reply"
    else
      printf '{"type":"u","data":[1001]}\n'
    fi ;;
  *"GetConnectionUnixUser s :1.20"*)
    if [[ -f "$state/kglobalaccel-uid-reply" ]]; then
      cat "$state/kglobalaccel-uid-reply"
    else
      printf '{"type":"u","data":[0]}\n'
    fi ;;
  *isScriptLoaded*)
    if [[ -f "$state/dbus-concat-loaded" ]]; then
      printf '{"type":"b","data":[false]}\n{"type":"b","data":[false]}\n'
    elif [[ -f "$state/loaded-malformed" ]]; then
      printf '{"type":"b","data":[true,false]}\n'
    elif [[ -f "$state/loaded" ]]; then
      printf '{"type":"b","data":[%s]}\n' "$(cat "$state/loaded")"
    else
      printf '{"type":"b","data":[false]}\n'
    fi ;;
  *introspect*)
    if [[ -f "$state/dbus-concat-iface" ]]; then
      printf '[{"type":"interface","name":"org.kde.kwin.Script"}]\n[{"type":"interface","name":"org.kde.kwin.Script"}]\n'
    elif [[ -f "$state/dbus-nonarray-iface" ]]; then
      printf '{"type":"interface","name":"org.kde.kwin.Script"}\n'
    elif [[ -f "$state/provenance-introspect-fails" && "$*" == *"/Scripting/Script19"* ]]; then
      exit 1
    elif [[ "$*" == *"/kglobalaccel"* ]]; then
      if [[ -f "$state/introspect-no-setter" ]]; then
        printf '[{"type":"interface","name":"org.kde.KGlobalAccel"}]\n'
      else
        printf '[{"type":"interface","name":"org.kde.KGlobalAccel"},{"name":".setShortcutKeys","type":"method","signature":"asa(ai)u","result_value":"a(ai)"}]\n'
      fi
    else
      printf '[{"type":"interface","name":"org.kde.kwin.Script"}]\n'
    fi ;;
  *unloadScript*)
    touch "$state/unload-called"
    if [[ -f "$state/replace-receipt-on-unload" && -n "${PROVENANCE_OWNERSHIP_FILE:-}" ]]; then
      rm -f -- "$PROVENANCE_OWNERSHIP_FILE"
      ln -s -- "${FAKE_REPLACEMENT_TARGET:?}" "$PROVENANCE_OWNERSHIP_FILE"
    fi
    if [[ -f "$state/unload-malformed" ]]; then
      printf 'not-json\n'
    elif [[ -f "$state/unload-fails" ]]; then
      printf '{"type":"b","data":[false]}\n'
    elif [[ "$*" == *plasma-auto-tiler-checkout-provenance-* && -f "$state/provenance-stop-fails" ]]; then
      printf '{"type":"b","data":[false]}\n'
    elif [[ "$*" == *plasma-auto-tiler-checkout-provenance-* && ! -f "$state/loaded" ]]; then
      printf '{"type":"b","data":[false]}\n'
    else
      printf 'false\n' > "$state/loaded"
      printf '{"type":"b","data":[true]}\n'
    fi ;;
  *loadScript*)
    touch "$state/load-called"
    if [[ -f "$state/load-block" ]]; then
      sleep 1
    fi
    if [[ -f "$state/load-reply-lost" ]]; then
      exit 1
    elif [[ -f "$state/load-malformed" ]]; then
      printf '{"type":"i","data":["not-an-int"]}\n'
    elif [[ -f "$state/dbus-concat-load" ]]; then
      printf '{"type":"i","data":[19]}\n{"type":"i","data":[19]}\n'
    else
      if [[ "$*" == *plasma-auto-tiler-checkout-provenance-* ]]; then
        printf 'true\n' > "$state/loaded"
        printf '{"type":"i","data":[19]}\n'
      else
        printf 'true\n' > "$state/loaded"
        printf '{"type":"i","data":[7]}\n'
      fi
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
  *org.kde.kwin.Script\ stop)
    touch "$state/stop-called"
    if [[ "$*" == *"/Scripting/Script19"* ]]; then
      rm -f "$state/loaded"
    fi
    [[ -f "$state/provenance-stop-fails" ]] && exit 1
    printf 'ok\n' ;;
  *org.kde.kwin.Script\ run)
    printf 'ok\n' ;;
  *allComponents*)
    touch "$state/all-components-called"
    if [[ -f "$state/dbus-concat-components" ]]; then
      printf '{"type":"ao","data":[["/component/kwin"]]}\n{"type":"ao","data":[["/component/kwin"]]}\n'
    elif [[ -f "$state/components" ]]; then
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
  *desktops*)
    if [[ -f "$state/desktops-fail" ]]; then
      exit 1
    elif [[ -f "$state/dbus-concat-desktops" ]]; then
      printf '{"type":"a(uss)","data":[]}\n{"type":"a(uss)","data":[]}\n'
    elif [[ -f "$state/desktops" ]]; then
      cat "$state/desktops"
    else
      printf '{"type":"a(uss)","data":[[1,"desktop-1","Desktop 1"],[2,"desktop-2","Desktop 2"]]}\n'
    fi ;;
  *)
    exit 1 ;;
esac
EOF
  chmod +x "$FAKE_BIN/bin/npm" "$FAKE_BIN/bin/pgrep" "$FAKE_BIN/bin/readlink" "$FAKE_BIN/bin/mktemp" "$FAKE_BIN/bin/sleep" "$FAKE_BIN/bin/busctl" "$FAKE_BIN/bin/journalctl"
}

setup_state() {
  rm -rf "$WORK/state"
  rm -f "$WORK/provenance-ownership" "$WORK/controller-ownership"
  mkdir -p "$WORK/state"
  printf '%s\n' "$1" > "$WORK/cursor"
  printf '%s' "$2" > "$WORK/journal_read"
  if [[ $# -ge 3 ]]; then
    printf '%s' "$3" > "$WORK/journal_after"
  else
    printf '%s' "$2" > "$WORK/journal_after"
  fi
}

write_controller_receipt() {
  printf '{"kind":"controller","nonce":"start-attempt","build":"controller-v1-%s","plugin":"plasma-auto-tiler-kwin","script_id":7,"pid":2517,"start_identity":"251700"}\n' "$CONTROLLER_DIGEST" > "$WORK/controller-ownership"
}

run_script() {
  set +e
  FAKE_STATE_DIR="$WORK/state" FAKE_JOURNAL_CURSOR="$WORK/cursor" FAKE_JOURNAL_READ="$WORK/journal_read" \
    FAKE_JOURNAL_AFTER="$WORK/journal_after" \
    FAKE_CONTROLLER_MESSAGE="${FAKE_CONTROLLER_MESSAGE_OVERRIDE:-$CONTROLLER_MESSAGE}" FAKE_CALL_LOG="$WORK/setshortcut.log" START_NONCE=start-attempt FAKE_KWIN_IDENTITY_SEQUENCE="${FAKE_KWIN_IDENTITY_SEQUENCE:-}" REAL_MKTEMP="$REAL_MKTEMP" REAL_SLEEP="$REAL_SLEEP" PROC_ROOT="$WORK/proc" FAKE_PROC_ROOT="$WORK/proc" FAKE_REPLACEMENT_TARGET="$WORK/replacement-target" PLASMA_AUTO_TILER_HERMETIC_TEST=1 PROVENANCE_PLUGIN_ID=plasma-auto-tiler-checkout-provenance-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa PROVENANCE_OWNERSHIP_FILE="$WORK/provenance-ownership" \
    CONTROLLER_OWNERSHIP_FILE="$WORK/controller-ownership" PATH="$FAKE_BIN/bin:$PATH" bash "$SCRIPT" "$@" >"$OUTPUT" 2>&1
  EXIT=$?
  set -e
}

run_script_signal() {
  set +e
  FAKE_STATE_DIR="$WORK/state" FAKE_JOURNAL_CURSOR="$WORK/cursor" FAKE_JOURNAL_READ="$WORK/journal_read" \
    FAKE_JOURNAL_AFTER="$WORK/journal_after" FAKE_CONTROLLER_MESSAGE="${FAKE_CONTROLLER_MESSAGE_OVERRIDE:-$CONTROLLER_MESSAGE}" \
    FAKE_CALL_LOG="$WORK/setshortcut.log" START_NONCE=start-attempt REAL_MKTEMP="$REAL_MKTEMP" REAL_SLEEP="$REAL_SLEEP" \
    PROC_ROOT="$WORK/proc" FAKE_PROC_ROOT="$WORK/proc" FAKE_REPLACEMENT_TARGET="$WORK/replacement-target" \
    PLASMA_AUTO_TILER_HERMETIC_TEST=1 PROVENANCE_PLUGIN_ID=plasma-auto-tiler-checkout-provenance-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    PROVENANCE_OWNERSHIP_FILE="$WORK/provenance-ownership" PATH="$FAKE_BIN/bin:$PATH" bash "$SCRIPT" provenance nonce-12345678 >"$OUTPUT" 2>&1 &
  signal_pid=$!
  for ((wait_attempt = 0; wait_attempt < 50; wait_attempt += 1)); do
    [[ -f "$WORK/state/load-called" ]] && break
    sleep 0.01
  done
  sleep 0.1
  kill -TERM "$signal_pid"
  wait "$signal_pid"
  EXIT=$?
  set -e
}

run_script_without_controller_receipt() {
  set +e
  env -u CONTROLLER_OWNERSHIP_FILE \
    FAKE_STATE_DIR="$WORK/state" FAKE_JOURNAL_CURSOR="$WORK/cursor" FAKE_JOURNAL_READ="$WORK/journal_read" \
    FAKE_JOURNAL_AFTER="$WORK/journal_after" \
    FAKE_CONTROLLER_MESSAGE="${FAKE_CONTROLLER_MESSAGE_OVERRIDE:-$CONTROLLER_MESSAGE}" FAKE_CALL_LOG="$WORK/setshortcut.log" START_NONCE=start-attempt REAL_MKTEMP="$REAL_MKTEMP" REAL_SLEEP="$REAL_SLEEP" PROC_ROOT="$WORK/proc" FAKE_PROC_ROOT="$WORK/proc" PLASMA_AUTO_TILER_HERMETIC_TEST=1 PROVENANCE_PLUGIN_ID=plasma-auto-tiler-checkout-provenance-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa PROVENANCE_OWNERSHIP_FILE="$WORK/provenance-ownership" \
    PATH="$FAKE_BIN/bin:$PATH" bash "$SCRIPT" "$@" >"$OUTPUT" 2>&1
  EXIT=$?
  set -e
}

run_script_without_provenance_receipt() {
  set +e
  env -u PROVENANCE_OWNERSHIP_FILE \
    FAKE_STATE_DIR="$WORK/state" FAKE_JOURNAL_CURSOR="$WORK/cursor" FAKE_JOURNAL_READ="$WORK/journal_read" \
    FAKE_JOURNAL_AFTER="$WORK/journal_after" \
    FAKE_CONTROLLER_MESSAGE="${FAKE_CONTROLLER_MESSAGE_OVERRIDE:-$CONTROLLER_MESSAGE}" FAKE_CALL_LOG="$WORK/setshortcut.log" START_NONCE=start-attempt REAL_MKTEMP="$REAL_MKTEMP" REAL_SLEEP="$REAL_SLEEP" PROC_ROOT="$WORK/proc" FAKE_PROC_ROOT="$WORK/proc" PLASMA_AUTO_TILER_HERMETIC_TEST=1 PROVENANCE_PLUGIN_ID=plasma-auto-tiler-checkout-provenance-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    PATH="$FAKE_BIN/bin:$PATH" bash "$SCRIPT" "$@" >"$OUTPUT" 2>&1
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

assert_occurrences() {
  local expected="$1" needle="$2"
  local n
  n="$(grep -Fc "$needle" "$OUTPUT" || true)"
  if [[ "$n" -eq "$expected" ]]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: expected $expected occurrence(s) of '$needle', got $n" >&2
    echo "--- output ---" >&2
    cat "$OUTPUT" >&2
    FAIL=$((FAIL + 1))
  fi
}

# Asserts that $before appears earlier in the output than $after.
assert_order() {
  local before="$1" after="$2"
  local bi ai
  bi="$(grep -Fn "$before" "$OUTPUT" | head -1 | cut -d: -f1)"
  ai="$(grep -Fn "$after" "$OUTPUT" | head -1 | cut -d: -f1)"
  if [[ -n "$bi" && -n "$ai" && "$bi" -lt "$ai" ]]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: expected '$before' before '$after'" >&2
    echo "--- output ---" >&2
    cat "$OUTPUT" >&2
    FAIL=$((FAIL + 1))
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

TEST_RECORDS='{"type":"a(ssssssaiai)","data":[[["plasma-auto-tiler-focus-left","Focus window left","kwin","KWin","default","Default Context",[402653256],[]],["plasma-auto-tiler-move-up","Move window up","kwin","KWin","default","Default Context",[436207691],[]],["plasma-auto-tiler-detach","Detach window from tile","kwin","KWin","default","Default Context",[301989920],[]],["plasma-auto-tiler-apply-columns","Apply columns in focused leaf","kwin","KWin","default","Default Context",[402653233],[]],["plasma-auto-tiler-insert-left","Insert next window left of focused leaf","kwin","KWin","default","Default Context",[419430418],[]],["plasma-auto-tiler-insert-up","Insert next window up of focused leaf","kwin","KWin","default","Default Context",[419430419],[]],["plasma-auto-tiler-insert-down","Insert next window down of focused leaf","kwin","KWin","default","Default Context",[419430421],[]],["KrohnkiteNextLayout","Krohnkite: Next Layout","kwin","KWin","default","Default Context",[268435548],[]]]]}'
READY_JOURNAL='{"MESSAGE":"plasma-auto-tiler:startup-handlers-ready"}'
CONTROLLER_DIGEST="$(sha256sum "$REPO_ROOT"/kwin/src/*.ts | sha256sum | awk '{print $1}')"
CONTROLLER_MESSAGE="plasma-auto-tiler:controller-ready:plugin=plasma-auto-tiler-kwin:nonce=start-attempt:build=controller-v1-$CONTROLLER_DIGEST"

# Eight project records carrying stale Meta+Alt assignments, plus eight records
# that already match the source defaults. Active field is the first integer
# array, default field the second.
RECONCILE_MISMATCH_RECORDS='{"type":"a(ssssssaiai)","data":[[["plasma-auto-tiler-focus-left","Focus window left","kwin","KWin","default","Default Context",[402653256],[]],["plasma-auto-tiler-focus-down","Focus window down","kwin","KWin","default","Default Context",[402653258],[]],["plasma-auto-tiler-focus-up","Focus window up","kwin","KWin","default","Default Context",[402653259],[]],["plasma-auto-tiler-focus-right","Focus window right","kwin","KWin","default","Default Context",[402653260],[]],["plasma-auto-tiler-move-left","Move window left","kwin","KWin","default","Default Context",[436207688],[]],["plasma-auto-tiler-move-down","Move window down","kwin","KWin","default","Default Context",[436207690],[]],["plasma-auto-tiler-move-up","Move window up","kwin","KWin","default","Default Context",[436207691],[]],["plasma-auto-tiler-move-right","Move window right","kwin","KWin","default","Default Context",[436207692],[]],["plasma-auto-tiler-insert-right","Insert next window right of focused leaf","kwin","KWin","default","Default Context",[419430420],[]],["plasma-auto-tiler-insert-left","Insert next window left of focused leaf","kwin","KWin","default","Default Context",[419430418],[]],["plasma-auto-tiler-insert-up","Insert next window up of focused leaf","kwin","KWin","default","Default Context",[419430419],[]],["plasma-auto-tiler-insert-down","Insert next window down of focused leaf","kwin","KWin","default","Default Context",[419430421],[]],["plasma-auto-tiler-detach","Detach window from tile","kwin","KWin","default","Default Context",[301989920],[]],["plasma-auto-tiler-attach","Attach window to available tile","kwin","KWin","default","Default Context",[436207648],[]],["plasma-auto-tiler-apply-columns","Apply columns in focused leaf","kwin","KWin","default","Default Context",[402653233],[]],["plasma-auto-tiler-apply-rows","Apply rows in focused leaf","kwin","KWin","default","Default Context",[402653234],[]],["plasma-auto-tiler-apply-balanced-grid","Apply balanced grid in focused leaf","kwin","KWin","default","Default Context",[402653235],[]],["plasma-auto-tiler-apply-dwindle","Apply dwindle in focused leaf","kwin","KWin","default","Default Context",[402653236],[]],["plasma-auto-tiler-fill-scope","Fill available tiles with windows","kwin","KWin","default","Default Context",[419430404],[]]]]}'

RECONCILE_MATCHED_RECORDS='{"type":"a(ssssssaiai)","data":[[["plasma-auto-tiler-focus-left","Focus window left","kwin","KWin","default","Default Context",[268435528],[]],["plasma-auto-tiler-focus-down","Focus window down","kwin","KWin","default","Default Context",[268435530],[]],["plasma-auto-tiler-focus-up","Focus window up","kwin","KWin","default","Default Context",[268435531],[]],["plasma-auto-tiler-focus-right","Focus window right","kwin","KWin","default","Default Context",[268435532],[]],["plasma-auto-tiler-move-left","Move window left","kwin","KWin","default","Default Context",[301989960],[]],["plasma-auto-tiler-move-down","Move window down","kwin","KWin","default","Default Context",[301989962],[]],["plasma-auto-tiler-move-up","Move window up","kwin","KWin","default","Default Context",[301989963],[]],["plasma-auto-tiler-move-right","Move window right","kwin","KWin","default","Default Context",[301989964],[]],["plasma-auto-tiler-insert-right","Insert next window right of focused leaf","kwin","KWin","default","Default Context",[419430420],[]],["plasma-auto-tiler-insert-left","Insert next window left of focused leaf","kwin","KWin","default","Default Context",[419430418],[]],["plasma-auto-tiler-insert-up","Insert next window up of focused leaf","kwin","KWin","default","Default Context",[419430419],[]],["plasma-auto-tiler-insert-down","Insert next window down of focused leaf","kwin","KWin","default","Default Context",[419430421],[]],["plasma-auto-tiler-detach","Detach window from tile","kwin","KWin","default","Default Context",[301989920],[]],["plasma-auto-tiler-attach","Attach window to available tile","kwin","KWin","default","Default Context",[436207648],[]],["plasma-auto-tiler-apply-columns","Apply columns in focused leaf","kwin","KWin","default","Default Context",[402653233],[]],["plasma-auto-tiler-apply-rows","Apply rows in focused leaf","kwin","KWin","default","Default Context",[402653234],[]],["plasma-auto-tiler-apply-balanced-grid","Apply balanced grid in focused leaf","kwin","KWin","default","Default Context",[402653235],[]],["plasma-auto-tiler-apply-dwindle","Apply dwindle in focused leaf","kwin","KWin","default","Default Context",[402653236],[]],["plasma-auto-tiler-fill-scope","Fill available tiles with windows","kwin","KWin","default","Default Context",[419430404],[]]]]}'

append_arrow_records() {
  jq -c '.data[0] += [
    ["plasma-auto-tiler-focus-left-arrow", "Focus window left (arrow)", "kwin", "KWin", "default", "Default Context", [285212690], []],
    ["plasma-auto-tiler-focus-down-arrow", "Focus window down (arrow)", "kwin", "KWin", "default", "Default Context", [285212693], []],
    ["plasma-auto-tiler-focus-up-arrow", "Focus window up (arrow)", "kwin", "KWin", "default", "Default Context", [285212691], []],
    ["plasma-auto-tiler-focus-right-arrow", "Focus window right (arrow)", "kwin", "KWin", "default", "Default Context", [285212692], []],
    ["plasma-auto-tiler-move-left-arrow", "Move window left (arrow)", "kwin", "KWin", "default", "Default Context", [318767122], []],
    ["plasma-auto-tiler-move-down-arrow", "Move window down (arrow)", "kwin", "KWin", "default", "Default Context", [318767125], []],
    ["plasma-auto-tiler-move-up-arrow", "Move window up (arrow)", "kwin", "KWin", "default", "Default Context", [318767123], []],
    ["plasma-auto-tiler-move-right-arrow", "Move window right (arrow)", "kwin", "KWin", "default", "Default Context", [318767124], []]
  ]'
}

RECONCILE_MISMATCH_RECORDS="$(append_arrow_records <<<"$RECONCILE_MISMATCH_RECORDS")"
RECONCILE_MATCHED_RECORDS="$(append_arrow_records <<<"$RECONCILE_MATCHED_RECORDS")"

make_fake_tools

# snapshot-kglobalaccel: UID zero is a valid strict unsigned D-Bus value, while
# negative, fractional, exponent, string, oversized, leading-zero, and
# ambiguous replies are rejected.
setup_state '-- cursor: cursor-1' ""
run_script snapshot-kglobalaccel
check_exit 0
assert_contains '"uid":0'

# snapshot-kglobalaccel: a D-Bus owner PID must be positive even when the UID
# is zero, so the combined identity {"pid":0,"uid":0} is rejected.
setup_state '-- cursor: cursor-1' ""
printf '{"type":"u","data":[0]}\n' > "$WORK/state/kglobalaccel-pid-reply"
run_script snapshot-kglobalaccel
check_exit 1
assert_contains "malformed KGlobalAccel owner PID reply"
assert_not_contains '"pid":0,"uid":0'

for uid_reply in \
  '{"type":"u","data":[-1]}' \
  '{"type":"u","data":[-0]}' \
  '{"type":"u","data":[01]}' \
  '{"type":"u","data":[1.5]}' \
  '{"type":"u","data":[1e3]}' \
  '{"type":"u","data":["0"]}' \
  '{"type":"u","data":[4294967296]}' \
  '{"type":"u","data":[0]}'$'\n''{"type":"u","data":[0]}' \
  '{"type":"u","data":[0],"extra":1}'; do
  setup_state '-- cursor: cursor-1' ""
  printf '%s\n' "$uid_reply" > "$WORK/state/kglobalaccel-uid-reply"
  run_script snapshot-kglobalaccel
  check_exit 1
  assert_contains "malformed KGlobalAccel owner UID reply"
done

# start: successful readiness
setup_state '-- cursor: cursor-1' "$READY_JOURNAL"
run_script start
check_exit 0
assert_contains "controller readiness confirmed"
assert_contains "started:"
assert_contains "build=controller-v1-"
assert_contains "kwin-pid=2517"
assert_contains "receipt={\"kind\":\"controller\""
# The process-name fixture is deliberately wrong and ambiguous. Receipt
# identity must come only from the org.kde.KWin D-Bus owner PID.
if [[ ! -e "$WORK/state/pgrep-count" ]]; then
  PASS=$((PASS + 1))
else
  echo "FAIL: start consulted the misleading pgrep fixture" >&2
  FAIL=$((FAIL + 1))
fi
# The stat fixture is sufficient even though the executable proc entry is
# absent and the test readlink command always fails.
if [[ ! -e "$WORK/proc/2517/exe" ]]; then
  PASS=$((PASS + 1))
else
  echo "FAIL: stat-success fixture unexpectedly exposed /proc/2517/exe" >&2
  FAIL=$((FAIL + 1))
fi

# start: a disabled diagnostic after readiness is reported as runtime failure
# rather than as disabled startup
setup_state '-- cursor: cursor-1' "" \
  '{"_PID":"2517","MESSAGE":"plasma-auto-tiler:startup-handlers-ready"}
{"_PID":"2517","MESSAGE":"plasma-auto-tiler:disabled:runtime-failed"}'
run_script start
check_exit 1
assert_contains "controller disabled after startup readiness"
assert_not_contains "controller disabled itself during startup"

# start: a same-PID start-time change immediately after load never creates a
# replacement-identity receipt and never tears down against the replacement.
setup_state '-- cursor: cursor-1' ""
FAKE_KWIN_IDENTITY_SEQUENCE='251700,251701' run_script start
check_exit 1
assert_contains "KWin process identity changed immediately after controller load"
assert_contains "start: partial script-id=7 cleanup=unverified"
[[ ! -f "$WORK/controller-ownership" ]] || { echo "FAIL: identity-race start created a controller receipt" >&2; FAIL=$((FAIL + 1)); }
[[ ! -f "$WORK/state/unload-called" ]] || { echo "FAIL: identity-race start unloaded against the replacement process" >&2; FAIL=$((FAIL + 1)); }

# start: evidence allocation failure after ownership retention uses exact
# cleanup and emits the partial result instead of exiting under set -e.
setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/evidence-mktemp-fails"
run_script start
check_exit 1
assert_contains "could not create the attempt evidence file"
assert_contains "start: partial script-id=7 cleanup=verified"
[[ -f "$WORK/state/unload-called" ]] || { echo "FAIL: evidence allocation failure did not attempt exact cleanup" >&2; FAIL=$((FAIL + 1)); }
[[ ! -f "$WORK/controller-ownership" ]] || { echo "FAIL: verified evidence-failure cleanup left the controller receipt" >&2; FAIL=$((FAIL + 1)); }

# start: readiness delay failure after ownership retention also uses exact
# cleanup and emits the partial result.
setup_state '-- cursor: cursor-1' '{"MESSAGE":"plasma-auto-tiler:shortcut-registered"}'
touch "$WORK/state/start-sleep-fails"
run_script start
check_exit 1
assert_contains "could not wait for KWin readiness diagnostics"
assert_contains "start: partial script-id=7 cleanup=verified"
[[ -f "$WORK/state/unload-called" ]] || { echo "FAIL: sleep failure did not attempt exact cleanup" >&2; FAIL=$((FAIL + 1)); }
[[ ! -f "$WORK/controller-ownership" ]] || { echo "FAIL: verified sleep-failure cleanup left the controller receipt" >&2; FAIL=$((FAIL + 1)); }

# provenance: the setup-only carrier is built separately, loaded with a
# distinct plugin identity, and accepts only an exact current-PID diagnostic.
PROVENANCE_DIGEST="$(sha256sum "$REPO_ROOT/kwin/src/provenance-entry.ts" | awk '{print $1}')"
PROVENANCE_PLUGIN="plasma-auto-tiler-checkout-provenance-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
PROVENANCE_MESSAGE="plasma-auto-tiler:provenance-ready:plugin=$PROVENANCE_PLUGIN:nonce=nonce-12345678:build=checkout-carrier-v1-$PROVENANCE_DIGEST"
setup_state '-- cursor: cursor-1' "" "{\"_PID\":\"2517\",\"MESSAGE\":\"$PROVENANCE_MESSAGE\"}"
run_script provenance nonce-12345678
check_exit 0
assert_contains "provenance: ready nonce=nonce-12345678"
assert_contains "provenance-baseline: plugin=$PROVENANCE_PLUGIN loaded=not-loaded"
assert_contains "script-id=19"
assert_contains "plugin=$PROVENANCE_PLUGIN"
assert_contains "receipt={\"kind\":\"provenance\""

# TERM during the synchronous load is deferred until the exact script ID and
# ownership receipt exist, then exact cleanup is performed before re-raising.
setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/load-block"
run_script_signal
check_exit 143
assert_contains "provenance: partial nonce=nonce-12345678 build=checkout-carrier-v1-"
assert_contains "script-id=19 plugin=$PROVENANCE_PLUGIN cleanup=verified"
[[ ! -e "$WORK/provenance-ownership" ]] || { echo "FAIL: interrupted provenance left its verified receipt" >&2; FAIL=$((FAIL + 1)); }
grep -Fq 'false' "$WORK/state/loaded" || { echo "FAIL: interrupted provenance left the carrier loaded" >&2; FAIL=$((FAIL + 1)); }

# provenance: standalone use retains a private random receipt before loading
# and prints the exact receipt path and teardown command.
setup_state '-- cursor: cursor-1' "" "{\"_PID\":\"2517\",\"MESSAGE\":\"$PROVENANCE_MESSAGE\"}"
run_script_without_provenance_receipt provenance nonce-12345678
check_exit 0
DEFAULT_PROVENANCE_RECEIPT="$(sed -n 's/^provenance receipt path: //p' "$OUTPUT")"
[[ -n "$DEFAULT_PROVENANCE_RECEIPT" && -f "$DEFAULT_PROVENANCE_RECEIPT" ]] || {
  echo "FAIL: standalone provenance did not retain a durable private receipt" >&2
  FAIL=$((FAIL + 1))
}
assert_contains "provenance-stop command:"
if [[ "$DEFAULT_PROVENANCE_RECEIPT" == "$WORK/provenance-ownership" ]]; then
  echo "FAIL: standalone provenance used the predictable test receipt path" >&2
  FAIL=$((FAIL + 1))
else
  PASS=$((PASS + 1))
fi
rm -f -- "$DEFAULT_PROVENANCE_RECEIPT"
rmdir -- "${DEFAULT_PROVENANCE_RECEIPT%/*}" 2>/dev/null || true

# provenance: stale nonce and PID-mismatched diagnostics fail closed and unload
# the attempted carrier rather than authorizing a setup result.
setup_state '-- cursor: cursor-1' "" \
  '{"_PID":"9999","MESSAGE":"plasma-auto-tiler:provenance-ready:plugin='"$PROVENANCE_PLUGIN"':nonce=nonce-12345678:build=checkout-carrier-v1-'"$PROVENANCE_DIGEST"'"}'
run_script provenance nonce-12345678
check_exit 1
assert_contains "provenance nonce/build diagnostic was not confirmed"
assert_not_contains "provenance: ready"

setup_state '-- cursor: cursor-1' "" \
  '{"_PID":"2517","MESSAGE":"plasma-auto-tiler:provenance-ready:plugin='"$PROVENANCE_PLUGIN"':nonce=stale-12345678:build=checkout-carrier-v1-'"$PROVENANCE_DIGEST"'"}'
run_script provenance nonce-12345678
check_exit 1
assert_contains "provenance nonce/build diagnostic was not confirmed"

# provenance: a same-PID start-time change immediately after load never writes
# a replacement-identity receipt and never unloads against the replacement.
setup_state '-- cursor: cursor-1' ""
FAKE_KWIN_IDENTITY_SEQUENCE='251700,251701' run_script provenance nonce-12345678
check_exit 1
assert_contains "KWin process identity changed immediately after provenance load"
assert_contains "provenance: partial nonce=nonce-12345678 build=checkout-carrier-v1-"
assert_contains "cleanup=unverified"
if [[ -f "$WORK/provenance-ownership" ]] && jq -e '.script_id == 19 and .pid == 2517 and .start_identity == "251700"' "$WORK/provenance-ownership" >/dev/null; then PASS=$((PASS + 1)); else echo "FAIL: identity-race provenance did not retain the original exact receipt" >&2; FAIL=$((FAIL + 1)); fi
[[ ! -f "$WORK/state/unload-called" ]] || { echo "FAIL: identity-race provenance unloaded against the replacement process" >&2; FAIL=$((FAIL + 1)); }

# provenance: when exact teardown fails, the failed command still returns a
# strict partial ownership record containing the exact script ID.
setup_state '-- cursor: cursor-1' "" \
  '{"_PID":"2517","MESSAGE":"plasma-auto-tiler:wrong-diagnostic"}'
touch "$WORK/state/provenance-stop-fails"
run_script provenance nonce-12345678
check_exit 1
assert_contains "provenance: partial nonce=nonce-12345678"
assert_contains "script-id=19 plugin=$PROVENANCE_PLUGIN cleanup=unverified"

# provenance: a post-load introspection failure also retains the exact ID for
# the attempted cleanup rather than silently discarding ownership.
setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/provenance-introspect-fails"
run_script provenance nonce-12345678
check_exit 1
assert_contains "provenance: partial nonce=nonce-12345678"
assert_contains "script-id=19 plugin=$PROVENANCE_PLUGIN cleanup=unverified"

# provenance-stop: only the retained exact script ID is accepted.
setup_state '-- cursor: cursor-1' "" "{\"_PID\":\"2517\",\"MESSAGE\":\"$PROVENANCE_MESSAGE\"}"
printf 'true\n' > "$WORK/state/loaded"
  printf '{"kind":"provenance","nonce":"nonce-12345678","build":"checkout-carrier-v1-%s","plugin":"%s","script_id":19,"pid":2517,"start_identity":"251700"}\n' "$PROVENANCE_DIGEST" "$PROVENANCE_PLUGIN" > "$WORK/provenance-ownership"
run_script provenance-stop 19
check_exit 0
assert_contains "provenance-stop: script-id=19 plugin=$PROVENANCE_PLUGIN unloaded and verified loaded-after=not-loaded"
[[ ! -f "$WORK/state/stop-called" ]] || { echo "FAIL: carrier teardown called Script<ID>.stop before unload" >&2; FAIL=$((FAIL + 1)); }
[[ -f "$WORK/state/unload-called" ]] || { echo "FAIL: carrier teardown did not call unloadScript" >&2; FAIL=$((FAIL + 1)); }
grep -Fq 'false' "$WORK/state/loaded" || { echo "FAIL: carrier teardown did not prove the carrier unloaded" >&2; FAIL=$((FAIL + 1)); }

# provenance: a carrier already loaded at baseline is a hard failure and never
# attempts a second load.
setup_state '-- cursor: cursor-1' ""
printf 'true\n' > "$WORK/state/loaded"
run_script provenance nonce-12345678
check_exit 1
assert_contains "provenance carrier is already loaded"
[[ ! -f "$WORK/state/load-called" ]] || { echo "FAIL: baseline-loaded carrier was loaded again" >&2; FAIL=$((FAIL + 1)); }

run_script provenance-stop 2147483648
check_exit 1
assert_contains "non-negative 32-bit script ID"

# provenance-stop: a receipt for another attempt is refused without touching
# the loaded carrier.
setup_state '-- cursor: cursor-1' ""
printf 'true\n' > "$WORK/state/loaded"
printf '{"kind":"provenance","nonce":"other-attempt","build":"checkout-carrier-v1-%s","plugin":"%s","script_id":18,"pid":2517,"start_identity":"251700"}\n' "$PROVENANCE_DIGEST" "$PROVENANCE_PLUGIN" > "$WORK/provenance-ownership"
run_script provenance-stop 19
check_exit 1
assert_contains "ownership receipt does not match script id 19"
grep -Fq 'true' "$WORK/state/loaded" || { echo "FAIL: stale receipt teardown changed loaded state" >&2; FAIL=$((FAIL + 1)); }

# provenance-stop: teardown uses the validated receipt and current KWin PID/start
# identity, not an impossible second run of the already-running Script<ID>.
setup_state '-- cursor: cursor-1' "" \
  '{"_PID":"2517","MESSAGE":"plasma-auto-tiler:provenance-ready:plugin='"$PROVENANCE_PLUGIN"':nonce=replaced-12345678:build=checkout-carrier-v1-'"$PROVENANCE_DIGEST"'"}'
printf 'true\n' > "$WORK/state/loaded"
printf '{"kind":"provenance","nonce":"nonce-12345678","build":"checkout-carrier-v1-%s","plugin":"%s","script_id":19,"pid":2517,"start_identity":"251700"}\n' "$PROVENANCE_DIGEST" "$PROVENANCE_PLUGIN" > "$WORK/provenance-ownership"
run_script provenance-stop 19
check_exit 0
assert_contains "provenance-stop: script-id=19"

# provenance-stop: no second diagnostic run is attempted during teardown.
setup_state '-- cursor: cursor-1' "" \
  '{"_PID":"2517","MESSAGE":"plasma-auto-tiler:provenance-ready:plugin=plasma-auto-tiler-checkout-provenance-cccccccccccccccccccccccccccccccc:nonce=nonce-12345678:build=checkout-carrier-v1-'"$PROVENANCE_DIGEST"'"}'
printf 'true\n' > "$WORK/state/loaded"
printf '{"kind":"provenance","nonce":"nonce-12345678","build":"checkout-carrier-v1-%s","plugin":"%s","script_id":19,"pid":2517,"start_identity":"251700"}\n' "$PROVENANCE_DIGEST" "$PROVENANCE_PLUGIN" > "$WORK/provenance-ownership"
run_script provenance-stop 19
check_exit 0
assert_contains "provenance-stop: script-id=19"

# provenance-stop: unloading is not verified when the KWin identity changes
# before the final postcondition is reported, even though the carrier is no
# longer loaded. The immutable receipt remains for a later safe decision.
setup_state '-- cursor: cursor-1' ""
printf 'true\n' > "$WORK/state/loaded"
printf '{"kind":"provenance","nonce":"nonce-12345678","build":"checkout-carrier-v1-%s","plugin":"%s","script_id":19,"pid":2517,"start_identity":"251700"}\n' "$PROVENANCE_DIGEST" "$PROVENANCE_PLUGIN" > "$WORK/provenance-ownership"
FAKE_KWIN_IDENTITY_SEQUENCE='251700,251700,251701' run_script provenance-stop 19
check_exit 1
assert_contains "KWin PID/start identity after unloadScript did not match the immutable ownership receipt"
assert_contains "exact provenance teardown was not verified"
assert_not_contains "provenance-stop: script-id=19"
[[ -f "$WORK/provenance-ownership" ]] || { echo "FAIL: identity-race teardown removed the provenance receipt" >&2; FAIL=$((FAIL + 1)); }

# snapshot-shortcuts: malformed tuple envelopes remain errors, not an empty
# baseline.
setup_state '-- cursor: cursor-1' ""
printf '{"type":"a(ssssssaiai)","data":[[["bad"]]]}\n' > "$WORK/state/shortcuts"
run_script snapshot-shortcuts
check_exit 1
assert_contains "unexpected allShortcutInfos reply"

# D-Bus array roots and envelopes reject concatenated documents.
setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/dbus-concat-components"
run_script snapshot-shortcuts
check_exit 1
assert_contains "unexpected allComponents reply"

setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/dbus-concat-desktops"
run_script desktops
check_exit 1
assert_contains "unexpected desktops reply"

# start: disabled readiness fails closed
setup_state '-- cursor: cursor-1' '{"MESSAGE":"plasma-auto-tiler:disabled:startup-failed"}'
run_script start
check_exit 1
assert_contains "controller disabled itself during startup"
assert_not_contains "started:"

# start: current disabled failure reports the exact disabled reason and
# separate kwin_scripting errors, all
# scoped to the current attempt (after-cursor, same-KWin-PID)
setup_state '-- cursor: cursor-1' \
  '{"MESSAGE":"plasma-auto-tiler:disabled:some-old-reason"}' \
  '{"_PID":"2517","MESSAGE":"plasma-auto-tiler:disabled:startup-failed"}
{"_PID":"2517","SYSLOG_IDENTIFIER":"kwin_scripting","MESSAGE":"script evaluation error: cannot read"}
{"_PID":"2517","MESSAGE":"plasma-auto-tiler:some-other-project-diagnostic"}'
run_script start
check_exit 1
assert_contains "controller disabled itself during startup"
assert_contains "controller diagnostics (current attempt, after-cursor, same-KWin-PID):"
assert_contains "disabled reasons (current attempt):"
assert_contains "plasma-auto-tiler:disabled:startup-failed"
assert_contains "kwin_scripting warnings/errors (current attempt):"
assert_contains "script evaluation error: cannot read"
assert_contains "plasma-auto-tiler:some-other-project-diagnostic"
assert_not_contains "some-old-reason"
assert_not_contains "started:"
# the retained evidence is reported before cleanup and again after cleanup
assert_occurrences 2 "controller diagnostics (current attempt, after-cursor, same-KWin-PID):"
assert_occurrences 2 "disabled reasons (current attempt):"
assert_occurrences 2 "kwin_scripting warnings/errors (current attempt):"
assert_order "disabled reasons (current attempt):" "error: controller disabled itself during startup"
NOTE_LINE="$(grep -Fn "note: exact controller teardown was verified; no plugin-name fallback was attempted" "$OUTPUT" | head -1 | cut -d: -f1)"
LAST_DISABLED="$(grep -Fn "disabled reasons (current attempt):" "$OUTPUT" | tail -1 | cut -d: -f1)"
if [[ -n "$NOTE_LINE" && -n "$LAST_DISABLED" && "$NOTE_LINE" -lt "$LAST_DISABLED" ]]; then
  PASS=$((PASS + 1))
else
  echo "FAIL: expected a second evidence report after the cleanup note" >&2
  echo "--- output ---" >&2
  cat "$OUTPUT" >&2
  FAIL=$((FAIL + 1))
fi

# start: a failed start never falls back to the historical (pre-cursor) epoch
# when a current attempt exists; only after-cursor same-PID evidence is reported
setup_state '-- cursor: cursor-1' \
  '{"_PID":"2517","MESSAGE":"plasma-auto-tiler:disabled:historical-reason"}
{"_PID":"2517","MESSAGE":"plasma-auto-tiler:disabled:historical-failed"}' \
  '{"_PID":"2517","MESSAGE":"plasma-auto-tiler:disabled:startup-failed"}
{"_PID":"2517","MESSAGE":"plasma-auto-tiler:startup-current-diagnostic"}'
run_script start
check_exit 1
assert_contains "plasma-auto-tiler:disabled:startup-failed"
assert_contains "plasma-auto-tiler:startup-current-diagnostic"
assert_not_contains "historical-reason"
assert_not_contains "plasma-auto-tiler-historical"

# start: missing readiness fails closed
setup_state '-- cursor: cursor-1' '{"MESSAGE":"plasma-auto-tiler:not-startup-ready"}'
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
assert_contains "start: partial script-id=unknown cleanup=unverified"
[[ ! -f "$WORK/state/unload-called" ]] || { echo "FAIL: malformed load used plugin-name teardown" >&2; FAIL=$((FAIL + 1)); }

# D-Bus replies are exactly one JSON document. Concatenated load and state
# replies are rejected before any guessed or broad teardown.
setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/dbus-concat-load"
run_script start
check_exit 1
assert_contains "loadScript reply is not a strict"
assert_not_contains "start: partial script-id=19"
[[ ! -f "$WORK/state/unload-called" ]] || { echo "FAIL: concatenated load used an unsafe teardown" >&2; FAIL=$((FAIL + 1)); }

setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/dbus-concat-loaded"
run_script start
check_exit 1
assert_contains "unexpected isScriptLoaded reply"

# Introspection must be one array-root JSON document, not an object or a
# concatenated pair of arrays.
setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/dbus-nonarray-iface"
run_script provenance nonce-12345678
check_exit 1
assert_contains "does not expose the org.kde.kwin.Script interface"

setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/dbus-concat-iface"
run_script provenance nonce-12345678
check_exit 1
assert_contains "does not expose the org.kde.kwin.Script interface"

# start: lost loadScript reply cannot identify a possibly loaded script, so it
# fails explicitly without an unsafe plugin-name unload.
setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/load-reply-lost"
run_script start
check_exit 1
assert_contains "loadScript reply was lost"
assert_contains "start: partial script-id=unknown cleanup=unverified"
[[ ! -f "$WORK/state/unload-called" ]] || { echo "FAIL: lost load reply used plugin-name teardown" >&2; FAIL=$((FAIL + 1)); }

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
assert_contains "controller readiness diagnostics (captured KWin PID/start identity + journal): observed"
assert_contains "project action records (KGlobalAccel): 7"
assert_contains "plasma-auto-tiler-focus-left"
assert_contains "plasma-auto-tiler-detach"
assert_contains "active \"402653256\""
assert_not_contains "KrohnkiteNextLayout"
assert_contains "do not prove live callbacks"
assert_contains "shortcut assignments: matched 5, drift 2, missing 20"
assert_contains "persisted shortcut assignments drift from controller source"

# status: a reused PID with a changed full start identity cannot make journal
# readiness current.
setup_state '-- cursor: cursor-1' "$READY_JOURNAL"
FAKE_KWIN_IDENTITY_SEQUENCE='251700,251701' run_script status
check_exit 0
assert_contains "controller readiness diagnostics (captured KWin PID/start identity + journal): unknown/not-ready (KWin PID/start identity changed during journal read)"

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
write_controller_receipt
run_script stop 7
check_exit 0
assert_contains "stop: plugin 'plasma-auto-tiler-kwin' unloaded"
assert_contains "project action records still registered in KGlobalAccel: 7"
assert_contains "does not roll back"
assert_contains "do not prove live callbacks"
grep -Fq "false" "$WORK/state/loaded" || {
  echo "FAIL: unload did not clear the loaded state" >&2
  FAIL=$((FAIL + 1))
}

# stop: a not-loaded plugin does not revalidate the retained script ID
setup_state '-- cursor: cursor-1' ""
printf '%s' "$TEST_RECORDS" > "$WORK/state/shortcuts"
write_controller_receipt
run_script stop 7
check_exit 1
assert_contains "refusing to use stale script id 7"

# stop: the validated immutable receipt, current KWin PID/start identity, exact
# Script<ID> interface, and loaded plugin state authorize teardown.
setup_state '-- cursor: cursor-1' ""
printf 'true\n' > "$WORK/state/loaded"
write_controller_receipt
FAKE_CONTROLLER_MESSAGE_OVERRIDE="plasma-auto-tiler:controller-ready:plugin=plasma-auto-tiler-kwin:nonce=replaced-12345678:build=controller-v1-$CONTROLLER_DIGEST" run_script stop 7
check_exit 0
assert_contains "stop: plugin 'plasma-auto-tiler-kwin' unloaded"
unset FAKE_CONTROLLER_MESSAGE_OVERRIDE

# stop: unloadScript returning false fails closed
setup_state '-- cursor: cursor-1' ""
printf 'true\n' > "$WORK/state/loaded"
touch "$WORK/state/unload-fails"
write_controller_receipt
run_script stop 7
check_exit 1
assert_contains "unloadScript returned false"

# stop: a KWin identity change after a successful exact unload leaves teardown
# unverified and does not proceed to persisted-record reporting.
setup_state '-- cursor: cursor-1' ""
printf 'true\n' > "$WORK/state/loaded"
write_controller_receipt
FAKE_KWIN_IDENTITY_SEQUENCE='251700,251700,251701' run_script stop 7
check_exit 1
assert_contains "KWin PID/start identity after unloadScript did not match the immutable ownership receipt"
assert_contains "exact controller teardown was not verified"
assert_not_contains "stop: plugin 'plasma-auto-tiler-kwin' unloaded"
[[ -f "$WORK/controller-ownership" ]] || { echo "FAIL: identity-race teardown removed the controller receipt" >&2; FAIL=$((FAIL + 1)); }
[[ ! -e "$WORK/state/all-components-called" ]] || { echo "FAIL: identity-race teardown continued into record reporting" >&2; FAIL=$((FAIL + 1)); }

# stop: a malformed unload reply is never treated as success, even when the
# loaded-state query is available.
setup_state '-- cursor: cursor-1' ""
printf 'true\n' > "$WORK/state/loaded"
touch "$WORK/state/unload-malformed"
write_controller_receipt
run_script stop 7
check_exit 1
assert_contains "exact controller teardown was not verified"

# start: without a caller-supplied receipt path, direct start retains ownership
# in a private random directory and prints the exact usable stop command.
setup_state '-- cursor: cursor-1' "$READY_JOURNAL"
run_script_without_controller_receipt start
check_exit 0
DEFAULT_RECEIPT="$(sed -n 's/^  CONTROLLER_OWNERSHIP_FILE=\([^ ]*\) bash .* stop 7$/\1/p' "$OUTPUT")"
[[ -n "$DEFAULT_RECEIPT" && -f "$DEFAULT_RECEIPT" ]] || {
  echo "FAIL: standalone start did not retain a durable private receipt" >&2
  FAIL=$((FAIL + 1))
}
if [[ -f "$DEFAULT_RECEIPT" ]] && jq -e '.kind == "controller" and .script_id == 7 and .plugin == "plasma-auto-tiler-kwin"' "$DEFAULT_RECEIPT" >/dev/null; then
  PASS=$((PASS + 1))
else
  echo "FAIL: standalone receipt did not contain exact controller ownership" >&2
  FAIL=$((FAIL + 1))
fi
assert_contains "bash $SCRIPT stop 7"
if [[ "$DEFAULT_RECEIPT" == "$WORK/controller-ownership" ]]; then
  echo "FAIL: standalone start used the test's predictable receipt path" >&2
  FAIL=$((FAIL + 1))
else
  PASS=$((PASS + 1))
fi
rm -f -- "$DEFAULT_RECEIPT"
rmdir -- "${DEFAULT_RECEIPT%/*}" 2>/dev/null || true

# stop: malformed isScriptLoaded reply fails closed
setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/loaded-malformed"
write_controller_receipt
run_script stop 7
check_exit 1
assert_contains "unexpected isScriptLoaded reply"

# provenance-stop refuses a receipt replaced by a symlink during teardown and
# never follows it into an outside path.
setup_state '-- cursor: cursor-1' ""
printf 'true\n' > "$WORK/state/loaded"
printf '{"kind":"provenance","nonce":"nonce-12345678","build":"checkout-carrier-v1-%s","plugin":"%s","script_id":19,"pid":2517,"start_identity":"251700"}\n' "$PROVENANCE_DIGEST" "$PROVENANCE_PLUGIN" > "$WORK/provenance-ownership"
printf 'outside-sentinel\n' > "$WORK/replacement-target"
touch "$WORK/state/replace-receipt-on-unload"
run_script provenance-stop 19
check_exit 1
assert_contains "receipt cleanup was not verified"
if grep -Fq "outside-sentinel" "$WORK/replacement-target"; then PASS=$((PASS + 1)); else echo "FAIL: outside replacement target changed" >&2; FAIL=$((FAIL + 1)); fi
[[ -L "$WORK/provenance-ownership" ]] || { echo "FAIL: replacement receipt symlink was not retained for safe recovery" >&2; FAIL=$((FAIL + 1)); }

# diagnostics: loaded current epoch with invoked/rejected/success tokens
setup_state '-- cursor: cursor-1' '{"_PID":"2517","MESSAGE":"plasma-auto-tiler:startup-handlers-ready"}
{"_PID":"2517","MESSAGE":"plasma-auto-tiler:preset-invoked:columns"}
{"_PID":"2517","MESSAGE":"plasma-auto-tiler:preset-rejected:source-occupancy-validity"}
{"_PID":"2517","MESSAGE":"plasma-auto-tiler:preset-applied:columns"}'
printf 'true\n' > "$WORK/state/loaded"
run_script diagnostics
check_exit 0
assert_contains "plugin: plasma-auto-tiler-kwin"
assert_contains "loaded: loaded"
assert_contains "kwin pid: 2517"
assert_contains "epoch (latest KWin-PID/start-identity-bound controller startup): current (plugin loaded)"
assert_contains "readiness: reached"
assert_contains "controller disabled: no"
assert_contains "callback invocation tokens (prove callback delivery):"
assert_contains "plasma-auto-tiler:preset-invoked:columns"
assert_contains "rejection tokens (prove callback reached a rejecting guard):"
assert_contains "plasma-auto-tiler:preset-rejected:source-occupancy-validity"
assert_contains "success tokens (prove the completed/successful stage):"
assert_contains "plasma-auto-tiler:preset-applied:columns"
assert_contains "do not prove callbacks"
assert_contains "not a current-liveness proof"

# diagnostics: unloaded evidence is labeled historical, never current
setup_state '-- cursor: cursor-1' '{"_PID":"2517","MESSAGE":"plasma-auto-tiler:startup-handlers-ready"}
{"_PID":"2517","MESSAGE":"plasma-auto-tiler:preset-applied:columns"}'
run_script diagnostics
check_exit 0
assert_contains "loaded: not-loaded"
assert_contains "epoch (latest KWin-PID/start-identity-bound controller startup): historical (plugin unloaded)"
assert_contains "plasma-auto-tiler:preset-applied:columns"
assert_not_contains "current (plugin loaded)"

# diagnostics: multiple starts selects only the latest epoch
setup_state '-- cursor: cursor-1' '{"_PID":"2517","MESSAGE":"plasma-auto-tiler:startup-handlers-ready"}
{"_PID":"2517","MESSAGE":"plasma-auto-tiler:preset-applied:columns"}
{"_PID":"2517","MESSAGE":"plasma-auto-tiler:startup-handlers-ready"}
{"_PID":"2517","MESSAGE":"plasma-auto-tiler:startup-handlers-ready"}
{"_PID":"2517","MESSAGE":"plasma-auto-tiler:move-completed"}'
printf 'true\n' > "$WORK/state/loaded"
run_script diagnostics
check_exit 0
assert_contains "plasma-auto-tiler:move-completed"
assert_not_contains "plasma-auto-tiler:preset-applied:columns"

# diagnostics: PID-mismatched journal records are excluded, never blended
setup_state '-- cursor: cursor-1' '{"_PID":"9999","MESSAGE":"plasma-auto-tiler:preset-applied:columns"}
{"_PID":"9999","MESSAGE":"plasma-auto-tiler:preset-applied:rows"}'
printf 'true\n' > "$WORK/state/loaded"
run_script diagnostics
check_exit 0
assert_contains "unknown (no journal records match captured KWin identity"
assert_not_contains "plasma-auto-tiler:preset-applied:"

# diagnostics: mixed-PID journal keeps only the current KWin pid evidence
setup_state '-- cursor: cursor-1' '{"_PID":"9999","MESSAGE":"plasma-auto-tiler:preset-applied:columns"}
{"_PID":"2517","MESSAGE":"plasma-auto-tiler:startup-handlers-ready"}
{"_PID":"2517","MESSAGE":"plasma-auto-tiler:preset-applied:rows"}'
printf 'true\n' > "$WORK/state/loaded"
run_script diagnostics
check_exit 0
assert_contains "plasma-auto-tiler:preset-applied:rows"
assert_not_contains "plasma-auto-tiler:preset-applied:columns"

# diagnostics: disabled startup is labeled disabled without a readiness claim
setup_state '-- cursor: cursor-1' '{"_PID":"2517","MESSAGE":"plasma-auto-tiler:disabled:startup-failed"}'
printf 'true\n' > "$WORK/state/loaded"
run_script diagnostics
check_exit 0
assert_contains "epoch (latest KWin-PID/start-identity-bound controller startup): disabled"
assert_contains "readiness: not-reached"
assert_contains "controller disabled: yes"
assert_contains "plasma-auto-tiler:disabled:startup-failed"
assert_not_contains "readiness: reached"

# diagnostics: a disabled diagnostic after readiness is runtime failure, not a
# second disabled startup epoch
setup_state '-- cursor: cursor-1' '{"_PID":"2517","MESSAGE":"plasma-auto-tiler:startup-handlers-ready"}
{"_PID":"2517","MESSAGE":"plasma-auto-tiler:disabled:runtime-failed"}'
printf 'true\n' > "$WORK/state/loaded"
run_script diagnostics
check_exit 0
assert_contains "epoch (latest KWin-PID/start-identity-bound controller startup): current (plugin loaded)"
assert_contains "readiness: reached"
assert_contains "controller disabled: yes"
assert_not_contains "disabled (latest startup disabled)"

# diagnostics: empty journal is labeled unknown, never presented as evidence
setup_state '-- cursor: cursor-1' ""
printf 'true\n' > "$WORK/state/loaded"
run_script diagnostics
check_exit 0
assert_contains "unknown/not-ready (no journal records for this KWin identity)"
assert_not_contains "preset-applied"

# diagnostics: malformed journal fails closed
setup_state '-- cursor: cursor-1' 'not json'
printf 'true\n' > "$WORK/state/loaded"
run_script diagnostics
check_exit 1
assert_contains "could not parse the KWin diagnostics journal"

# diagnostics: matches the fixed prefix regardless of journal category
setup_state '-- cursor: cursor-1' '{"_PID":"2517","SYSLOG_IDENTIFIER":"kwin_wayland","PRIORITY":"7","MESSAGE":"plasma-auto-tiler:startup-handlers-ready"}
{"_PID":"2517","SYSLOG_IDENTIFIER":"kwin_scripting","PRIORITY":"4","MESSAGE":"plasma-auto-tiler:preset-applied:columns"}
{"_PID":"2517","SYSLOG_IDENTIFIER":"kwin_scripting","PRIORITY":"4","MESSAGE":"plasma-auto-tiler:keyboard-completed"}'
printf 'true\n' > "$WORK/state/loaded"
run_script diagnostics
check_exit 0
assert_contains "plasma-auto-tiler:preset-applied:columns"
assert_contains "plasma-auto-tiler:keyboard-completed"
assert_contains "readiness: reached"

# diagnostics: unrelated journal messages are never reported
setup_state '-- cursor: cursor-1' '{"_PID":"2517","MESSAGE":"kwin_scripting: something unrelated"}
{"_PID":"2517","MESSAGE":"plasma-auto-tiler:startup-handlers-ready"}
{"_PID":"2517","MESSAGE":"Failed to load something"}
{"_PID":"2517","MESSAGE":"Krohnkite: next layout"}'
printf 'true\n' > "$WORK/state/loaded"
run_script diagnostics
check_exit 0
assert_contains "plasma-auto-tiler:startup-handlers-ready"
assert_not_contains "something unrelated"
assert_not_contains "Failed to load"
assert_not_contains "Krohnkite"

# diagnostics: a KWin PID change during the journal read invalidates the epoch
setup_state '-- cursor: cursor-1' '{"_PID":"2517","MESSAGE":"plasma-auto-tiler:startup-handlers-ready"}'
printf 'true\n' > "$WORK/state/loaded"
printf '9999\n' > "$WORK/state/dbus-next-pid"
run_script diagnostics
check_exit 0
assert_contains "unknown/not-ready (KWin PID/start identity changed during journal read)"
assert_not_contains "startup-handlers-ready"

# diagnostics: PID reuse with the same numeric PID is rejected when the full
# start identity changes during the journal read.
setup_state '-- cursor: cursor-1' '{"_PID":"2517","MESSAGE":"plasma-auto-tiler:startup-handlers-ready"}'
printf 'true\n' > "$WORK/state/loaded"
FAKE_KWIN_IDENTITY_SEQUENCE='251700,251701' run_script diagnostics
check_exit 0
assert_contains "unknown/not-ready (KWin PID/start identity changed during journal read)"
assert_not_contains "readiness: reached"

# stat identity is required and malformed or unreadable stat fails closed.
setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/stat-malformed"
run_script status
check_exit 0
assert_contains "KWin PID/start identity unavailable"

setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/stat-unreadable"
run_script start
check_exit 1
assert_contains "could not capture KWin PID/start identity"

# diagnostics: strict parsing rejects extra arguments
setup_state '-- cursor: cursor-1' ""
run_script diagnostics extra
check_exit 1
assert_contains "takes no arguments"

# desktops: strict decode of the real a(uss) envelope reports every row in order
setup_state '-- cursor: cursor-1' ""
printf '%s\n' '{"type":"a(uss)","data":[[0,"desktop-0","Desktop 0"],[1,"desktop-1","Desktop 1"]]}' > "$WORK/state/desktops"
run_script desktops
check_exit 0
assert_contains "virtual desktops: 2"
assert_contains "desktop-0"
assert_contains "desktop-1"
assert_contains "Desktop 0"
assert_contains "Desktop 1"
assert_contains "never mutates"
assert_no_setshortcut_calls

# desktops: the live envelope decodes without an extra data[0] level
setup_state '-- cursor: cursor-1' ""
run_script desktops
check_exit 0
assert_contains "virtual desktops: 2"
assert_contains "desktop-1"
assert_contains "desktop-2"
assert_no_setshortcut_calls

# desktops: unexpected envelope keys fail closed
setup_state '-- cursor: cursor-1' ""
printf '%s\n' '{"type":"a(uss)","data":[],"extra":1}' > "$WORK/state/desktops"
run_script desktops
check_exit 1
assert_contains "unexpected desktops reply"

# desktops: wrong envelope type fails closed
setup_state '-- cursor: cursor-1' ""
printf '%s\n' '{"type":"a(sss)","data":[["a","b","c"]]}' > "$WORK/state/desktops"
run_script desktops
check_exit 1
assert_contains "unexpected desktops reply"

# desktops: non-array data fails closed
setup_state '-- cursor: cursor-1' ""
printf '%s\n' '{"type":"a(uss)","data":"nope"}' > "$WORK/state/desktops"
run_script desktops
check_exit 1
assert_contains "unexpected desktops reply"

# desktops: the extra data[0] array level that broke the prior probe fails closed
setup_state '-- cursor: cursor-1' ""
printf '%s\n' '{"type":"a(uss)","data":[[[1,"desktop-1","Desktop 1"]]]}' > "$WORK/state/desktops"
run_script desktops
check_exit 1
assert_contains "unexpected desktops reply"

# desktops: non-integral position fails closed
setup_state '-- cursor: cursor-1' ""
printf '%s\n' '{"type":"a(uss)","data":[[1.5,"desktop-1","Desktop 1"]]}' > "$WORK/state/desktops"
run_script desktops
check_exit 1
assert_contains "unexpected desktops reply"

# desktops: negative position fails closed
setup_state '-- cursor: cursor-1' ""
printf '%s\n' '{"type":"a(uss)","data":[[-1,"desktop-1","Desktop 1"]]}' > "$WORK/state/desktops"
run_script desktops
check_exit 1
assert_contains "unexpected desktops reply"

# desktops: non-number position fails closed
setup_state '-- cursor: cursor-1' ""
printf '%s\n' '{"type":"a(uss)","data":[[1,"desktop-1","D1"],[2,5,"D2"]]}' > "$WORK/state/desktops"
run_script desktops
check_exit 1
assert_contains "unexpected desktops reply"

# desktops: empty id fails closed
setup_state '-- cursor: cursor-1' ""
printf '%s\n' '{"type":"a(uss)","data":[[1,"","Desktop 1"]]}' > "$WORK/state/desktops"
run_script desktops
check_exit 1
assert_contains "unexpected desktops reply"

# desktops: empty name fails closed
setup_state '-- cursor: cursor-1' ""
printf '%s\n' '{"type":"a(uss)","data":[[1,"desktop-1",""]]}' > "$WORK/state/desktops"
run_script desktops
check_exit 1
assert_contains "unexpected desktops reply"

# desktops: malformed tuple arity fails closed
setup_state '-- cursor: cursor-1' ""
printf '%s\n' '{"type":"a(uss)","data":[["desktop-1","Desktop 1"]]}' > "$WORK/state/desktops"
run_script desktops
check_exit 1
assert_contains "unexpected desktops reply"

# desktops: duplicate positions fail closed
setup_state '-- cursor: cursor-1' ""
printf '%s\n' '{"type":"a(uss)","data":[[1,"desktop-1","D1"],[1,"desktop-2","D2"]]}' > "$WORK/state/desktops"
run_script desktops
check_exit 1
assert_contains "unexpected desktops reply"

# desktops: duplicate ids fail closed
setup_state '-- cursor: cursor-1' ""
printf '%s\n' '{"type":"a(uss)","data":[[1,"desktop-1","D1"],[2,"desktop-1","D2"]]}' > "$WORK/state/desktops"
run_script desktops
check_exit 1
assert_contains "unexpected desktops reply"

# desktops: an empty valid enumeration still decodes
setup_state '-- cursor: cursor-1' ""
printf '%s\n' '{"type":"a(uss)","data":[]}' > "$WORK/state/desktops"
run_script desktops
check_exit 0
assert_contains "virtual desktops: 0"
assert_no_setshortcut_calls

# desktops: transport failure fails closed
setup_state '-- cursor: cursor-1' ""
touch "$WORK/state/desktops-fail"
run_script desktops
check_exit 1
assert_contains "desktops call failed"
assert_no_setshortcut_calls

# desktops: strict parsing rejects extra arguments
setup_state '-- cursor: cursor-1' ""
run_script desktops extra
check_exit 1
assert_contains "takes no arguments"
assert_no_setshortcut_calls

# start/status/stop/diagnostics/desktops must never mutate shortcut records
assert_no_setshortcut_calls

# reconcile-shortcuts: read-only report on stale records never mutates
setup_state '-- cursor: cursor-1' ""
printf '%s' "$RECONCILE_MISMATCH_RECORDS" > "$WORK/state/shortcuts"
run_script reconcile-shortcuts
check_exit 0
assert_contains "reconcile-shortcuts: read-only report (no mutation)"
assert_contains "setShortcutKeys asa(ai)u -> a(ai)"
assert_contains "matched: 19"
assert_contains "mismatched: 8"
assert_contains 'action "plasma-auto-tiler-focus-left" active "402653256" expected "268435528"'
assert_contains 'action "plasma-auto-tiler-focus-right" active "402653260" expected "268435532"'
assert_contains "missing: 0"
assert_contains "unrelated target conflicts: 0"
assert_contains "run 'reconcile-shortcuts --apply'"
assert_no_setshortcut_calls

# reconcile-shortcuts: all records already matching reports nothing to write
setup_state '-- cursor: cursor-1' ""
printf '%s' "$RECONCILE_MATCHED_RECORDS" > "$WORK/state/shortcuts"
run_script reconcile-shortcuts
check_exit 0
assert_contains "matched: 27"
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
assert_contains "refusing to apply with 27 project ownership error"
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

# Fixed project-only rows: literal registerShortcut calls in the controller.
while IFS=$'\t' read -r action sequence shortcut; do
  if ! grep -Fq "[$action]=\"$sequence\"" "$SCRIPT"; then
    echo "FAIL: lifecycle catalog lacks $action=$sequence" >&2
    FAIL=$((FAIL + 1))
  elif grep -Fq "registerShortcut" "$CONTROLLER"; then
    echo "FAIL: controller still exposes shortcut registration" >&2
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
done <<'EOF'
plasma-auto-tiler-insert-right	419430420	Meta+Alt+Right
plasma-auto-tiler-insert-left	419430418	Meta+Alt+Left
plasma-auto-tiler-insert-up	419430419	Meta+Alt+Up
plasma-auto-tiler-insert-down	419430421	Meta+Alt+Down
plasma-auto-tiler-detach	301989920	Meta+Shift+Space
plasma-auto-tiler-attach	436207648	Meta+Alt+Shift+Space
plasma-auto-tiler-fill-scope	419430404	Meta+Alt+Return
plasma-auto-tiler-apply-columns	402653233	Meta+Alt+1
plasma-auto-tiler-apply-rows	402653234	Meta+Alt+2
plasma-auto-tiler-apply-balanced-grid	402653235	Meta+Alt+3
plasma-auto-tiler-apply-dwindle	402653236	Meta+Alt+4
EOF

# Catalog-driven focus/move directional rows: derive expected sequences from
# the cosmic catalog's directional(...) rows and require the lifecycle catalog
# to match the Qt-encoded sequence. Any future catalog sequence change is
# caught here instead of drifting silently.
COSMIC_ROWS_SRC="$(sed -n '/const COSMIC_ROWS/,/^const HYPRLAND_ROWS/p' "$CONTROLLER" | sed '$d')"
while IFS= read -r line; do
  if [[ "$line" != *"directional("* ]]; then
    continue
  fi
  if [[ "$line" =~ directional\(\"([^\"]+)\",[[:space:]]*\"[^\"]*\",[[:space:]]*\"([^\"]*)\",[[:space:]]*\"([^\"]*)\",[[:space:]]*([A-Za-z_]+), ]]; then
    prefix="${BASH_REMATCH[1]}"
    modifiers="${BASH_REMATCH[2]}"
    suffix="${BASH_REMATCH[3]}"
    keys_name="${BASH_REMATCH[4]}"
    if [[ "$keys_name" == "HJKL_KEYS" ]]; then
      keys_list=("${HJKL_KEYS_LIST[@]}")
    else
      keys_list=("${ARROW_KEYS_LIST[@]}")
    fi
    for entry in "${keys_list[@]}"; do
      dir="${entry%% *}"
      key="${entry##* }"
      action="plasma-auto-tiler-${prefix}-${dir}"
      if [[ -n "$suffix" ]]; then
        action="${action}-${suffix}"
      fi
      sequence="$(encode_sequence "${modifiers}+${key}")"
      if ! grep -Fq "[$action]=\"$sequence\"" "$SCRIPT"; then
        echo "FAIL: lifecycle catalog lacks $action=$sequence" >&2
        FAIL=$((FAIL + 1))
      else
        PASS=$((PASS + 1))
      fi
    done
  fi
done <<<"$COSMIC_ROWS_SRC"

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
