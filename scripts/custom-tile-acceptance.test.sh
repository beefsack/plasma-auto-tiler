#!/usr/bin/env bash
set -euo pipefail

readonly REPO_ROOT="$(cd -- "${BASH_SOURCE[0]%/*}/.." && pwd -P)"
readonly HARNESS="$REPO_ROOT/scripts/custom-tile-acceptance.sh"
readonly WORK="$(mktemp -d "$REPO_ROOT/.custom-tile-acceptance.XXXXXX")"
readonly FAKE_BIN="$WORK/fake-bin"
readonly PROC_FIXTURE_ROOT="$WORK/proc-fixture"
readonly HOME_ROOT="$WORK/home"
readonly OUTPUT="$WORK/output"
readonly DIAGNOSTICS="$WORK/stderr"
readonly CALLS="$WORK/calls"
readonly FORBIDDEN="$WORK/forbidden"
readonly FAKE_SHORTCUT_COUNT="$WORK/shortcut-count"
readonly GREP_BIN="$(command -v grep)"
readonly JQ_BIN="$(command -v jq)"
readonly REAL_JQ_BIN="$JQ_BIN"
readonly REAL_PYTHON_BIN="$(command -v python3)"
readonly REAL_READLINK_BIN="$(command -v readlink)"
readonly REAL_STAT_BIN="$(command -v stat)"
readonly REAL_TR_BIN="$(command -v tr)"
PASS=0
FAILURES=0
EXIT_STATUS=0

cleanup() { rm -rf -- "$WORK"; }
trap cleanup EXIT

pass() { PASS=$((PASS + 1)); }
fail_test() { printf 'FAIL: %s\n' "$1" >&2; FAILURES=$((FAILURES + 1)); }

assert_true() { if "$@"; then pass; else fail_test "$*"; fi; }
assert_false() { if "$@"; then fail_test "expected failure: $*"; else pass; fi; }
assert_contains() { if "$GREP_BIN" -Fq -- "$1" "$2"; then pass; else fail_test "$2 lacks $1"; fi; }
assert_absent() { if "$GREP_BIN" -Fq -- "$1" "$2"; then fail_test "$2 contains banned $1"; else pass; fi; }

make_proc_fixture() {
  mkdir -p "$PROC_FIXTURE_ROOT"
  printf 'Name:\tfixture\nState:\tS (sleeping)\nUid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\nGroups:\t1000\nNStgid:\t12345\nNSpid:\t12345\nThreads:\t1\n' > "$PROC_FIXTURE_ROOT/status"
}

make_fake_bus() {
  cat > "$FAKE_BIN/busctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
trace() { local args; printf -v args ' %q' "$@"; printf 'busctl%s\n' "$args" >> "${CALLS:?}"; }
bad_shape() { trace "$@"; exit 2; }
[[ "$#" -ge 7 && "$1" == '--address=unix:path=/run/user/1000/bus' && "$2" == '--json=short' && "$3" == call ]] || bad_shape "$@"
trace "$@"
case "$7" in
  ListNames) [[ "$#" -eq 7 && "$4" == org.freedesktop.DBus && "$5" == /org/freedesktop/DBus && "$6" == org.freedesktop.DBus ]] || bad_shape "$@"
    case "${FAKE_MODE:-success}" in
      malformed-list) printf '{"type":"as","data":[["org.kde.KWin"]],"extra":true}\n' ;;
      duplicate-json) printf '{"type":"as","type":"as","data":[["org.kde.KWin"]]}\n' ;;
      oversized-reply) printf '{"type":"as","data":[["'; printf '%*s' 1100000 x; printf '"]]}\n' ;;
      invalid-name) printf '{"type":"as","data":[["bad/name"]]}\n' ;;
      absent-kg) printf '{"type":"as","data":[["org.kde.KWin",":1.10"]]}\n' ;;
      *) printf '{"type":"as","data":[["org.kde.KWin","org.kde.kglobalaccel",":1.10",":1.11"]]}\n' ;;
    esac ;;
  GetNameOwner) [[ "$#" -eq 9 && "$4" == org.freedesktop.DBus && "$5" == /org/freedesktop/DBus && "$6" == org.freedesktop.DBus && "$8" == s && "$9" =~ ^org\.kde\.(KWin|kglobalaccel)$ ]] || bad_shape "$@"
    service="$9"
    if [[ "$service" == org.kde.KWin ]]; then
      if [[ "${FAKE_MODE:-}" == ambiguous-owner ]]; then printf '{"type":"s","data":[":1.10",":1.12"]}\n'; exit 0; fi
      if [[ "${FAKE_MODE:-}" == duplicate-json ]]; then printf '{"type":"s","type":"s","data":[":1.10"]}\n'; exit 0; fi
      owner_count=0
      [[ -f "$FAKE_OWNER_COUNT" ]] && owner_count="$(<"$FAKE_OWNER_COUNT")"
      owner_count=$((owner_count + 1))
      printf '%s\n' "$owner_count" > "$FAKE_OWNER_COUNT"
      if [[ "${FAKE_MODE:-}" == drift && "$owner_count" -gt 1 ]]; then printf '{"type":"s","data":[":1.99"]}\n'; else printf '{"type":"s","data":[":1.10"]}\n'; fi
    else printf '{"type":"s","data":[":1.11"]}\n'; fi ;;
  GetConnectionUnixProcessID) [[ "$#" -eq 9 && "$4" == org.freedesktop.DBus && "$5" == /org/freedesktop/DBus && "$6" == org.freedesktop.DBus && "$8" == s && "$9" =~ ^:[0-9]+\.[0-9]+$ ]] || bad_shape "$@"
    owner="$9"
    case "${FAKE_MODE:-}" in
      *) case "$owner" in
           :1.10|:1.99) printf '{"type":"u","data":[%s]}\n' "${FAKE_KWIN_PID:?}" ;;
           :1.11) printf '{"type":"u","data":[%s]}\n' "${FAKE_KG_PID:?}" ;;
           *) bad_shape "$@" ;;
         esac ;;
    esac ;;
  GetConnectionUnixUser) [[ "$#" -eq 9 && "$4" == org.freedesktop.DBus && "$5" == /org/freedesktop/DBus && "$6" == org.freedesktop.DBus && "$8" == s && "$9" =~ ^:[0-9]+\.[0-9]+$ ]] || bad_shape "$@"
    case "${FAKE_MODE:-}" in uid-mismatch) printf '{"type":"u","data":[1001]}\n' ;; *) printf '{"type":"u","data":[1000]}\n' ;; esac ;;
  allComponents) [[ "$#" -eq 7 && "$4" == org.kde.kglobalaccel && "$5" == /kglobalaccel && "$6" == org.kde.KGlobalAccel ]] || bad_shape "$@"
    case "${FAKE_MODE:-success}" in
      malformed-components) printf '{"type":"ao","data":[["/component/kwin"]],"unknown":1}\n' ;;
      duplicate-components) printf '{"type":"ao","data":[["/component/kwin","/component/kwin"]]}\n' ;;
      duplicate-json) printf '{"type":"ao","type":"ao","data":[["/component/kwin"]]}\n' ;;
      invalid-component) printf '{"type":"ao","data":[["/component/bad-name"]]}\n' ;;
      oversized-reply) printf '{"type":"ao","data":[["/component/kwin"]]}\n' ;;
      *) printf '{"type":"ao","data":[["/component/kwin"]]}\n' ;;
    esac ;;
  allShortcutInfos) [[ "$#" -eq 9 && "$4" == org.kde.kglobalaccel && "$5" =~ ^/component/[A-Za-z0-9_-]+$ && "$6" == org.kde.kglobalaccel.Component && "$8" == s && "$9" == default ]] || bad_shape "$@"
    shortcut_count=0
    [[ -f "$FAKE_SHORTCUT_COUNT" ]] && shortcut_count="$(<"$FAKE_SHORTCUT_COUNT")"
    shortcut_count=$((shortcut_count + 1))
    printf '%s\n' "$shortcut_count" > "$FAKE_SHORTCUT_COUNT"
    case "${FAKE_MODE:-success}" in
      malformed-shortcuts) printf '{"type":"a(ssssssaiai)","data":[[["bad"]]]}\n' ;;
      oversized-reply) printf '{"type":"a(ssssssaiai)","data":[[['; printf '%*s' 1100000 x; printf ']]]}\n' ;;
      duplicate-json) printf '{"type":"a(ssssssaiai)","type":"a(ssssssaiai)","data":[[]]}\n' ;;
      unknown-project) "$REAL_JQ_BIN" -c '.data[0] += [["plasma-auto-tiler-unknown", "unknown", "kwin", "KWin", "default", "Default", [99], []]]' "$FAKE_SHORTCUTS" ;;
      missing-project) "$REAL_JQ_BIN" -c '.data[0] |= map(select(.[0] != "plasma-auto-tiler-insert-right"))' "$FAKE_SHORTCUTS" ;;
      post-enumeration-drift) if [[ "$shortcut_count" -gt 1 ]]; then "$REAL_JQ_BIN" -c '(.data[0] | map(if .[0] == "plasma-auto-tiler-insert-right" then .[6] = [1] else . end)) as $r | {type:.type,data:[$r]}' "$FAKE_SHORTCUTS"; else "$REAL_JQ_BIN" -c . "$FAKE_SHORTCUTS"; fi ;;
      *) "$REAL_JQ_BIN" -c . "$FAKE_SHORTCUTS" ;;
    esac ;;
  *) bad_shape "$@" ;;
esac
EOF
  chmod +x "$FAKE_BIN/busctl"
}

make_fake_loginctl() {
  cat > "$FAKE_BIN/loginctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
trace() { local args; printf -v args ' %q' "$@"; printf 'loginctl%s\n' "$args" >> "${CALLS:?}"; }
case "$1" in
  list-sessions)
    [[ "$#" -eq 3 && "$2" == --no-legend && "$3" == --no-pager ]] || { trace "$@"; exit 2; }
    trace "$@"
    case "${FAKE_MODE:-success}" in
      real-order) printf '2 1000 user seat0\n3 1000 user seat1\n' ;;
      wrong-session) printf '42 1000 user seat0\n' ;;
      ambiguous-session) printf '42 1000 user seat0\n43 1000 user seat1\n' ;;
      *) printf '42 1000 user seat0\n' ;;
    esac ;;
  show-session)
    [[ "$#" -eq 15 && "$2" =~ ^(2|3|42|43)$ && "$3" == -p && "$4" == User && "$5" == -p && "$6" == Type && "$7" == -p && "$8" == Class && "$9" == -p && "${10}" == State && "${11}" == -p && "${12}" == Desktop && "${13}" == -p && "${14}" == Leader && "${15}" == --no-pager ]] || { trace "$@"; exit 2; }
    trace "$@"
    case "${FAKE_MODE:-success}" in
      malformed-session) printf 'User=1000\nType=wayland\nClass=user\nState=active\nDesktop=KDE\n' ;;
      real-order)
        if [[ "$2" == 3 ]]; then
          printf 'User=1000\nDesktop=\nLeader=1819\nType=unspecified\nClass=manager\nState=active\n'
        else
          printf 'User=1000\nDesktop=KDE\nLeader=1792\nType=wayland\nClass=user\nState=active\n'
        fi ;;
      wrong-session) printf 'User=1000\nType=tty\nClass=user\nState=active\nDesktop=KDE\nLeader=9000\n' ;;
      *) printf 'User=1000\nType=wayland\nClass=user\nState=active\nDesktop=KDE\nLeader=9000\n' ;;
    esac ;;
  *) trace "$@"; exit 2 ;;
esac
EOF
  chmod +x "$FAKE_BIN/loginctl"
}

make_fake_python() {
  cat > "$FAKE_BIN/python3" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
trace() { local args; printf -v args ' %q' "$@"; printf 'python3%s\n' "$args" >> "${CALLS:?}"; }
[[ "$#" -ge 2 && "$1" == -c ]] || { trace "$@"; exit 2; }
if [[ "$#" -eq 2 ]]; then
  [[ "$2" == *json.loads* && "$2" == *object_pairs_hook* && "$2" == *ensure_ascii=True* ]] || { trace "$@"; exit 2; }
  trace python3-canonical-json
  exec "$REAL_PYTHON_BIN" "$@"
fi
[[ "$#" -eq 3 && "$2" == *pathlib.Path* && "$2" == *read_bytes* && "$3" =~ ^/proc/(self|[0-9]+)/(status|stat|cmdline|cgroup)$ ]] || { trace "$@"; exit 2; }
trace python3-read-proc "$3"
case "$3" in
  */status)
    if [[ "${FAKE_MODE:-}" == proc-uid-mismatch ]]; then
      printf 'Name:\tfixture\nUid:\t1001\t1001\t1001\t1001\nThreads:\t1\n'
    else
      while IFS= read -r line; do printf '%s\n' "$line"; done < "$PROC_FIXTURE_ROOT/status"
    fi ;;
  */stat)
    printf '1 (fixture) S'
    for ((i = 0; i < 18; i += 1)); do printf ' 0'; done
    printf ' 10001 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n' ;;
  */cmdline)
    printf '%s\0--session\0' "$FAKE_BIN/kwin_wayland" ;;
  */cgroup)
    if [[ "${FAKE_MODE:-}" == real-order ]]; then printf '0::/user.slice/user-1000.slice/session-2.scope\n'; else printf '0::/user.slice/user-1000.slice/session-42.scope\n'; fi ;;
esac
EOF
  chmod +x "$FAKE_BIN/python3"
}

make_fake_readlink() {
  cat > "$FAKE_BIN/readlink" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
trace() { local args; printf -v args ' %q' "$@"; printf 'readlink%s\n' "$args" >> "${CALLS:?}"; }
[[ "$#" -eq 3 && "$1" == -f && "$2" == -- ]] || { trace "$@"; exit 2; }
trace "$@"
case "$3" in
  "/proc/${FAKE_KWIN_PID:?}/exe")
    [[ "${FAKE_MODE:-}" == wrong-executable ]] && printf '%s/other\n' "$FAKE_BIN" || printf '%s/kwin_wayland\n' "$FAKE_BIN" ;;
  "$FAKE_BIN/kwin_wayland") "$REAL_READLINK_BIN" -f -- "$3" ;;
  *) trace "$@"; exit 2 ;;
esac
EOF
  chmod +x "$FAKE_BIN/readlink"
}

make_fake_stat() {
  cat > "$FAKE_BIN/stat" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
trace() { local args; printf -v args ' %q' "$@"; printf 'stat%s\n' "$args" >> "${CALLS:?}"; }
[[ "$#" -eq 4 && "$1" == -c && ( "$2" == '%u %a' || "$2" == '%u' ) && "$3" == -- && ( "$4" == / || "$HOME_ROOT" == "$4" || "$HOME_ROOT" == "$4"/* || "$4" == "$HOME_ROOT"/* ) ]] || { trace "$@"; exit 2; }
trace "$@"
exec "$REAL_STAT_BIN" "$@"
EOF
  chmod +x "$FAKE_BIN/stat"
}

make_fake_tr() {
  cat > "$FAKE_BIN/tr" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
trace() { local args; printf -v args ' %q' "$@"; printf 'tr%s\n' "$args" >> "${CALLS:?}"; }
[[ "$#" -eq 2 && "$1" == '\0' && "$2" == '\n' ]] || { trace "$@"; exit 2; }
trace "$@"
exec "$REAL_TR_BIN" "$@"
EOF
  chmod +x "$FAKE_BIN/tr"
}

make_fake_jq() {
  cat > "$FAKE_BIN/jq" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
trace() { local args; printf -v args ' %q' "$@"; printf 'jq%s\n' "$args" >> "${CALLS:?}"; }
bad_shape() { trace "$@"; exit 2; }
[[ "$#" -ge 2 && ( "$1" == -e || "$1" == -r || "$1" == -c || "$1" == -cn ) ]] || bad_shape "$@"
i=2
while [[ "$i" -lt "$#" ]]; do
  case "${!i}" in
    --arg|--argjson)
      j=$((i + 1))
      [[ "$i" -le $(( $# - 3 )) && "${!j}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || bad_shape "$@"
      ((i += 3)) ;;
    *) [[ "$i" -eq "$#" ]] || bad_shape "$@"; break ;;
  esac
done
[[ "$i" -eq "$#" && -n "${!i}" ]] || bad_shape "$@"
if [[ "${FAKE_MODE:-}" == dependency-failure || ( "${FAKE_MODE:-}" == json-emission-failure && "$*" == *'--arg schema '* ) ]]; then
  trace "$@"
  exit 2
fi
trace "$@"
exec "$REAL_JQ_BIN" "$@"
EOF
  chmod +x "$FAKE_BIN/jq"
}

make_forbidden() {
  local name
  for name in kwin_wayland weston-terminal dbus-run-session dbus-send qdbus kwriteconfig6 systemctl kill pkill rm mkdir mktemp; do
    printf '#!/usr/bin/env bash\nprintf "forbidden:%%s\\n" "$0" >> "%s"\nprintf "%%s %%s\\n" "%s" "$*" >> "${CALLS:?}"\nexit 99\n' "$FORBIDDEN" "$name" > "$FAKE_BIN/$name"
    chmod +x "$FAKE_BIN/$name"
  done
}

run_case() {
  local mode="$1"
  : > "$FAKE_OWNER_COUNT"
  : > "$FAKE_SHORTCUT_COUNT"
  set +e
    DBUS_SESSION_BUS_ADDRESS=unix:path=/private/wrong-bus \
    PLASMA_AUTO_TILER_PROC_ROOT="$PROC_FIXTURE_ROOT" \
    HOME="$HOME_ROOT" XDG_CONFIG_HOME="${TEST_XDG_CONFIG_HOME:-}" PATH="$FAKE_BIN:$PATH" FAKE_MODE="$mode" \
    FAKE_KWIN_PID="$$" FAKE_KG_PID="$PPID" \
    bash "$HARNESS" preflight > "$OUTPUT" 2> "$DIAGNOSTICS"
  EXIT_STATUS=$?
  set -e
}

expect_status() { [[ "$EXIT_STATUS" -eq "$1" ]] || fail_test "expected status $1, got $EXIT_STATUS"; }

make_fixture() {
  "$JQ_BIN" -n '
    {
      "plasma-auto-tiler-insert-right":419430420,"plasma-auto-tiler-insert-left":419430418,
      "plasma-auto-tiler-insert-up":419430419,"plasma-auto-tiler-insert-down":419430421,
      "plasma-auto-tiler-focus-left":268435528,"plasma-auto-tiler-focus-down":268435530,
      "plasma-auto-tiler-focus-up":268435531,"plasma-auto-tiler-focus-right":268435532,
      "plasma-auto-tiler-focus-left-arrow":285212690,"plasma-auto-tiler-focus-down-arrow":285212693,
      "plasma-auto-tiler-focus-up-arrow":285212691,"plasma-auto-tiler-focus-right-arrow":285212692,
      "plasma-auto-tiler-move-left":301989960,"plasma-auto-tiler-move-down":301989962,
      "plasma-auto-tiler-move-up":301989963,"plasma-auto-tiler-move-right":301989964,
      "plasma-auto-tiler-move-left-arrow":318767122,"plasma-auto-tiler-move-down-arrow":318767125,
      "plasma-auto-tiler-move-up-arrow":318767123,"plasma-auto-tiler-move-right-arrow":318767124,
      "plasma-auto-tiler-detach":301989920,"plasma-auto-tiler-attach":436207648,
      "plasma-auto-tiler-fill-scope":419430404,"plasma-auto-tiler-apply-columns":402653233,
      "plasma-auto-tiler-apply-rows":402653234,"plasma-auto-tiler-apply-balanced-grid":402653235,
      "plasma-auto-tiler-apply-dwindle":402653236
    } as $expected |
    {type:"a(ssssssaiai)",data:[[$expected|to_entries[]|[.key,.key,"kwin","KWin","default","Default Context",[.value],[]]]]} ' > "$WORK/shortcuts.json"
}

mkdir -p "$FAKE_BIN" "$PROC_FIXTURE_ROOT" "$HOME_ROOT/.config"
make_proc_fixture
printf 'no-tiling-state=true\n' > "$HOME_ROOT/.config/kwinrc"
printf x > "$FAKE_BIN/other"
make_fixture
make_fake_bus
make_fake_loginctl
make_forbidden
make_fake_python
make_fake_readlink
make_fake_stat
make_fake_tr
make_fake_jq
export FAKE_SHORTCUTS="$WORK/shortcuts.json" FAKE_OWNER_COUNT="$WORK/owner-count" FAKE_SHORTCUT_COUNT JQ_BIN REAL_JQ_BIN CALLS HOME_ROOT PROC_FIXTURE_ROOT REAL_PYTHON_BIN REAL_READLINK_BIN REAL_STAT_BIN REAL_TR_BIN FAKE_BIN

assert_true bash -n "$HARNESS"
assert_true bash -n "$BASH_SOURCE"
assert_contains 'readonly SCHEMA_VERSION=' "$HARNESS"
assert_contains 'readonly COMMAND_ALLOWLIST=' "$HARNESS"
assert_absent 'PLASMA_AUTO_TILER_PROC_ROOT' "$HARNESS"
assert_contains 'loginctl' "$HARNESS"
assert_contains 'session scope' "$HARNESS"
assert_absent 'PLASMA_AUTO_TILER_BUSCTL' "$HARNESS"
assert_absent 'kglobalaccel5' "$HARNESS"
assert_absent 'kglobalaccel6' "$HARNESS"
assert_absent 'resolve_optional_tool' "$HARNESS"
assert_contains 'fresh-owned-scope' "$HARNESS"
assert_contains 'exact_prestate' "$HARNESS"
assert_contains 're_resolve_after_each' "$HARNESS"
assert_contains 'homogeneous only' "$HARNESS"
assert_contains 'remove_then_split' "$HARNESS"
assert_contains 'timer_barriers' "$HARNESS"
assert_contains 'manual_input' "$HARNESS"
assert_contains 'retains only bounded exact evidence' "$HARNESS"
for banned in loadScript unloadScript invokeShortcut createDesktop 'tile.split(' 'tile.remove(' QTimer dbus-run-session '--user' 'kwin_wayland --' 'WAYLAND_DISPLAY' ' eval ' 'kill ' 'rm -' 'mkdir ' 'mktemp'; do
  assert_absent "$banned" "$HARNESS"
done

run_case success
expect_status 0
assert_true "$JQ_BIN" -e '.schema_version == "custom-tile-acceptance-preflight-v2" and .live_acceptance == false and .authoritative_ready == false and .setup_ready == true and .journey_ready == false and .readiness_blocker == "controller_checkout_identity unavailable: no supported authoritative read-only interface binds the loaded controller/script to this checkout" and .command_allowlist == ["busctl","jq","loginctl","python3","readlink","stat","tr"] and (.current_host_discovery.services | length) == 2 and .current_host_discovery.session.id == "42" and .current_host_discovery.session.bus_address == "unix:path=/run/user/1000/bus" and .current_host_discovery.kwin_service_identity.pre and .current_host_discovery.controller_checkout_identity.status == "blocked" and .current_host_discovery.controller_checkout_identity.authoritative == false and .current_host_discovery.controller_checkout_identity.blocker == "no-supported-authoritative-read-only-binding-to-this-checkout" and .current_host_discovery.kglobalaccel.status == "verified" and (.current_host_discovery.kglobalaccel.exact_tuples | length) == 27 and .current_host_discovery.kwin_service_identity.pre.pid != .current_host_discovery.kglobalaccel.pre.pid and .current_host_discovery.kglobalaccel.pre.pid == .current_host_discovery.kglobalaccel.post.pid and (.current_host_discovery.kglobalaccel.pre | has("executable") | not) and .gates.controller_identity == "not-established" and .gates.kwin_service_identity == "verified-session-scoped-service-owner" and .gates.controller_checkout_identity == "blocked" and .gates.readiness == "blocked-controller-checkout-identity" and .gates.shortcut_ownership_collision == "verified" and .prospective_future_plan.manual_input.currently_allowed == false' "$OUTPUT"
assert_true "$JQ_BIN" -e '.prospective_future_plan.scope.reuse_persistent_scope == false and .prospective_future_plan.scope.resolved_private_root.mode == "0700 exactly" and .prospective_future_plan.prestate.config.exact_path == (env.HOME_ROOT + "/.config/kwinrc") and .prospective_future_plan.prestate.config.kwinrc.before.mtime_ns and .prospective_future_plan.journal.format == "atomic journal with sequence, operation, exact owned resource identity and expected pre/post state" and .prospective_future_plan.interruption.cleanup == "never remove resources not owned by this run" and (.prospective_future_plan.evidence.raw_host_policy | contains("persists no raw host evidence"))' "$OUTPUT"
if [[ "$(wc -l < "$OUTPUT")" -eq 1 ]]; then pass; else fail_test 'successful preflight did not emit one document'; fi
assert_absent '/private/wrong-bus' "$CALLS"
if [[ ! -s "$DIAGNOSTICS" ]]; then pass; else fail_test 'successful preflight wrote diagnostics to stderr'; fi

run_case real-order
expect_status 0
assert_true "$JQ_BIN" -e '.current_host_discovery.session.id == "2" and .current_host_discovery.session.leader == 1792' "$OUTPUT"
assert_contains 'loginctl show-session 3' "$CALLS"

run_case absent-kg
expect_status 0
assert_true "$JQ_BIN" -e '.current_host_discovery.kglobalaccel.status == "absent" and .authoritative_ready == false and .setup_ready == true and .journey_ready == false' "$OUTPUT"

for mode in malformed-list malformed-components malformed-shortcuts duplicate-components ambiguous-owner unknown-project missing-project duplicate-json invalid-name invalid-component oversized-reply malformed-session wrong-session ambiguous-session uid-mismatch proc-uid-mismatch wrong-executable dependency-failure json-emission-failure; do
  run_case "$mode"
  expect_status 1
  assert_true "$JQ_BIN" -e '.status == "preflight-failed" and .authoritative_ready == false and .setup_ready == false and .journey_ready == false' "$OUTPUT"
  if [[ "$(wc -l < "$OUTPUT")" -eq 1 ]]; then pass; else fail_test 'failure preflight did not emit one verdict'; fi
  assert_contains 'error:' "$DIAGNOSTICS"
done

for mode in drift; do
  run_case "$mode"
  expect_status 1
  assert_true "$JQ_BIN" -e '.status == "preflight-failed" and .authoritative_ready == false and .setup_ready == false and .journey_ready == false' "$OUTPUT"
  if [[ "$(wc -l < "$OUTPUT")" -eq 1 ]]; then pass; else fail_test 'drift preflight did not emit one verdict'; fi
  assert_contains 'drift detected' "$DIAGNOSTICS"
done

run_case post-enumeration-drift
expect_status 1
assert_true "$JQ_BIN" -e '.status == "preflight-failed" and .authoritative_ready == false and .setup_ready == false and .journey_ready == false' "$OUTPUT"
if [[ "$(wc -l < "$OUTPUT")" -eq 1 ]]; then pass; else fail_test 'post-enumeration drift did not emit one verdict'; fi
assert_contains 'KGlobalAccel shortcut contract drift detected' "$DIAGNOSTICS"

ln -s "$WORK" "$HOME_ROOT/.config/kwinrc-link"
rm -f -- "$HOME_ROOT/.config/kwinrc"
ln -s "$WORK/kwinrc-target" "$HOME_ROOT/.config/kwinrc"
printf 'clean=true\n' > "$WORK/kwinrc-target"
run_case success
expect_status 1
assert_true "$JQ_BIN" -e '.status == "preflight-failed"' "$OUTPUT"
assert_contains 'KWin config path is a symlink' "$DIAGNOSTICS"
rm -f -- "$HOME_ROOT/.config/kwinrc"
printf '[Tiling][stale]\n' > "$HOME_ROOT/.config/kwinrc"
run_case success
expect_status 1
assert_true "$JQ_BIN" -e '.status == "preflight-failed"' "$OUTPUT"
assert_contains 'stale persisted tiling state' "$DIAGNOSTICS"
printf 'clean=true\n' > "$HOME_ROOT/.config/kwinrc"

TEST_XDG_CONFIG_HOME="$HOME_ROOT/../escape"
run_case success
expect_status 1
assert_true "$JQ_BIN" -e '.status == "preflight-failed"' "$OUTPUT"
assert_contains 'traversal' "$DIAGNOSTICS"
unset TEST_XDG_CONFIG_HOME
ln -s "$HOME_ROOT/.config" "$HOME_ROOT/config-link"
TEST_XDG_CONFIG_HOME="$HOME_ROOT/config-link"
run_case success
expect_status 1
assert_true "$JQ_BIN" -e '.status == "preflight-failed"' "$OUTPUT"
assert_contains 'symlinked' "$DIAGNOSTICS"
unset TEST_XDG_CONFIG_HOME

for mutation in collision ownership drift-shortcut duplicate-shortcut; do
  case "$mutation" in
    collision) "$JQ_BIN" '.data[0] += [["unrelated", "unrelated", "other", "Other", "default", "Default", [419430420], []]]' "$WORK/shortcuts.json" > "$WORK/changed.json" ;;
    ownership) "$JQ_BIN" '(.data[0] | map(if .[0] == "plasma-auto-tiler-insert-right" then .[2] = "other" else . end)) as $r | {type:.type,data:[$r]}' "$WORK/shortcuts.json" > "$WORK/changed.json" ;;
    drift-shortcut) "$JQ_BIN" '(.data[0] | map(if .[0] == "plasma-auto-tiler-insert-right" then .[6] = [1] else . end)) as $r | {type:.type,data:[$r]}' "$WORK/shortcuts.json" > "$WORK/changed.json" ;;
    duplicate-shortcut) "$JQ_BIN" '.data[0] += [.data[0][0]]' "$WORK/shortcuts.json" > "$WORK/changed.json" ;;
  esac
  export FAKE_SHORTCUTS="$WORK/changed.json"
  run_case success
  expect_status 1
  assert_true "$JQ_BIN" -e '.status == "preflight-failed"' "$OUTPUT"
  assert_contains 'error:' "$DIAGNOSTICS"
done
export FAKE_SHORTCUTS="$WORK/shortcuts.json"

if [[ -s "$FORBIDDEN" ]]; then fail_test 'a forbidden or mutating command was invoked'; else pass; fi
if [[ ! -s "$CALLS" ]] || "$GREP_BIN" -Ev '^(busctl|jq|loginctl|python3|readlink|stat|tr)( |$)' "$CALLS" | "$GREP_BIN" -q .; then fail_test 'unexpected command or D-Bus method was invoked'; else pass; fi
for tool in busctl jq loginctl python3 readlink stat tr; do
  if "$GREP_BIN" -q "^$tool " "$CALLS"; then pass; else fail_test "command oracle did not trace $tool"; fi
done

printf 'custom-tile-acceptance tests: passes=%s failures=%s\n' "$PASS" "$FAILURES"
[[ "$FAILURES" -eq 0 ]]
