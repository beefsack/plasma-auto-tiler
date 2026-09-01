#!/usr/bin/env bash
set -euo pipefail

readonly DBUS_SERVICE="org.freedesktop.DBus"
readonly DBUS_PATH="/org/freedesktop/DBus"
readonly DBUS_IFACE="org.freedesktop.DBus"
readonly KWIN_SERVICE="org.kde.KWin"
readonly KG_SERVICE="org.kde.kglobalaccel"
readonly KG_PATH="/kglobalaccel"
readonly KG_IFACE="org.kde.KGlobalAccel"
readonly KG_COMPONENT_IFACE="org.kde.kglobalaccel.Component"
readonly EXPECTED_OWNER="kwin"
readonly SCHEMA_VERSION="custom-tile-acceptance-preflight-v2"
readonly COMMAND_ALLOWLIST="busctl,jq,loginctl,python3,readlink,stat,tr"
readonly MAX_REPLY_BYTES=1048576
readonly MAX_NAMES=1024
readonly MAX_COMPONENTS=128
readonly MAX_SHORTCUT_ROWS=4096
readonly MAX_STRING_BYTES=256
readonly MAX_SHORTCUT_KEYS=64
readonly PYTHON_READ_PROC='import pathlib, sys

path = pathlib.Path(sys.argv[1])
data = path.read_bytes()
if len(data) > 65536:
    raise ValueError("process metadata is oversized")
sys.stdout.buffer.write(data)'

readonly PROJECT_SHORTCUTS_JSON='{
  "plasma-auto-tiler-insert-right":419430420,
  "plasma-auto-tiler-insert-left":419430418,
  "plasma-auto-tiler-insert-up":419430419,
  "plasma-auto-tiler-insert-down":419430421,
  "plasma-auto-tiler-focus-left":268435528,
  "plasma-auto-tiler-focus-down":268435530,
  "plasma-auto-tiler-focus-up":268435531,
  "plasma-auto-tiler-focus-right":268435532,
  "plasma-auto-tiler-focus-left-arrow":285212690,
  "plasma-auto-tiler-focus-down-arrow":285212693,
  "plasma-auto-tiler-focus-up-arrow":285212691,
  "plasma-auto-tiler-focus-right-arrow":285212692,
  "plasma-auto-tiler-move-left":301989960,
  "plasma-auto-tiler-move-down":301989962,
  "plasma-auto-tiler-move-up":301989963,
  "plasma-auto-tiler-move-right":301989964,
  "plasma-auto-tiler-move-left-arrow":318767122,
  "plasma-auto-tiler-move-down-arrow":318767125,
  "plasma-auto-tiler-move-up-arrow":318767123,
  "plasma-auto-tiler-move-right-arrow":318767124,
  "plasma-auto-tiler-detach":301989920,
  "plasma-auto-tiler-attach":436207648,
  "plasma-auto-tiler-fill-scope":419430404,
  "plasma-auto-tiler-apply-columns":402653233,
  "plasma-auto-tiler-apply-rows":402653234,
  "plasma-auto-tiler-apply-balanced-grid":402653235,
  "plasma-auto-tiler-apply-dwindle":402653236
}'

BUSCTL_BIN=""
JQ_BIN=""
LOGINCTL_BIN=""
PYTHON_BIN=""
READLINK_BIN=""
STAT_BIN=""
TR_BIN=""
KWIN_BIN=""
KG_BIN=""
readonly PROC_ROOT="/proc"
CURRENT_UID=""
SESSION_ID=""
SESSION_LEADER=""
SESSION_BUS_ADDRESS=""
CONFIG_HOME=""
CONFIG_PATH=""
REPLY=""
NAMES_JSON=""
KWIN_PRE=""
KWIN_POST=""
KG_PRE=""
KG_POST=""
KG_STATUS="absent"
KG_DIAGNOSTIC="well-known service is absent; this is diagnostic information, not a failure"
COMPONENTS_JSON='[]'
RECORDS_JSON='[]'
PERSISTED_STATE="clean"

usage() {
  printf '%s\n' \
    'usage: custom-tile-acceptance.sh <command>' \
    '' \
    'Commands:' \
    '  preflight  discover the current user session using read-only calls' \
    '  --help     show this help'
}

fail() {
  printf 'error: %s\n' "$1" >&2
  return 1
}

resolve_tool() {
  local requested="$1" resolved
  case "$requested" in
    busctl|jq|loginctl|python3|readlink|stat|tr|kwin_wayland|kglobalacceld) ;;
    *) fail "unknown tool: $requested" ;;
  esac
  resolved="$(command -v -- "$requested" 2>/dev/null || true)"
  [[ "$resolved" == /* && -x "$resolved" && ! -d "$resolved" ]] || fail "tool is not executable: $requested"
  printf '%s\n' "$resolved"
}

resolve_optional_tool() {
  local requested="$1" resolved
  case "$requested" in
    kglobalacceld|kglobalaccel5|kglobalaccel6|kglobalaccel) ;;
    *) fail "unknown optional tool: $requested" ;;
  esac
  resolved="$(command -v -- "$requested" 2>/dev/null || true)"
  if [[ -n "$resolved" && "$resolved" == /* && -x "$resolved" && ! -d "$resolved" ]]; then
    printf '%s\n' "$resolved"
  fi
}

canonical_json() {
  local value json_bytes
  value="$1"
  json_bytes="${#value}"
  (( json_bytes <= MAX_REPLY_BYTES )) || return 1
  REPLY="$(printf '%s' "$value" | "$PYTHON_BIN" -c 'import json, sys

def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result

def constant(value):
    raise ValueError("non-standard JSON constant")

raw = sys.stdin.buffer.read()
if len(raw) > 1048576:
    raise ValueError("JSON reply is oversized")
value = json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)
sys.stdout.write(json.dumps(value, ensure_ascii=True, separators=(",", ":")))' )" || return 1
}

read_proc_file() {
  local path="$1"
  [[ "$path" =~ ^/proc/(self|[1-9][0-9]*)/(status|stat|cmdline|cgroup)$ ]] || fail 'invalid process metadata path'
  [[ -f "$path" && ! -L "$path" ]] || return 1
  "$PYTHON_BIN" -c "$PYTHON_READ_PROC" "$path"
}

dbus_reply() {
  local value
  value="$1"
  canonical_json "$value" || return 1
}

call_list_names() {
  "$BUSCTL_BIN" --address="$SESSION_BUS_ADDRESS" --json=short call "$DBUS_SERVICE" "$DBUS_PATH" "$DBUS_IFACE" ListNames
}

call_name_owner() {
  "$BUSCTL_BIN" --address="$SESSION_BUS_ADDRESS" --json=short call "$DBUS_SERVICE" "$DBUS_PATH" "$DBUS_IFACE" GetNameOwner s "$1"
}

call_pid() {
  "$BUSCTL_BIN" --address="$SESSION_BUS_ADDRESS" --json=short call "$DBUS_SERVICE" "$DBUS_PATH" "$DBUS_IFACE" GetConnectionUnixProcessID s "$1"
}

call_uid() {
  "$BUSCTL_BIN" --address="$SESSION_BUS_ADDRESS" --json=short call "$DBUS_SERVICE" "$DBUS_PATH" "$DBUS_IFACE" GetConnectionUnixUser s "$1"
}

call_components() {
  "$BUSCTL_BIN" --address="$SESSION_BUS_ADDRESS" --json=short call "$KG_SERVICE" "$KG_PATH" "$KG_IFACE" allComponents
}

call_shortcut_infos() {
  "$BUSCTL_BIN" --address="$SESSION_BUS_ADDRESS" --json=short call "$KG_SERVICE" "$1" "$KG_COMPONENT_IFACE" allShortcutInfos s default
}

strict_string_reply() {
  local value="$1"
  "$JQ_BIN" -e '((keys | sort) == ["data","type"]) and (.type == "s") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "string") and ((.data[0] | utf8bytelength) > 0) and ((.data[0] | utf8bytelength) <= 256)' <<<"$value" >/dev/null
}

strict_uint_reply() {
  local value="$1"
  "$JQ_BIN" -e '((keys | sort) == ["data","type"]) and (.type == "u") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "number") and ((.data[0] | floor) == .data[0]) and (.data[0] > 0) and (.data[0] <= 4294967295)' <<<"$value" >/dev/null
}

strict_names_reply() {
  local value="$1"
  "$JQ_BIN" -e '
    ((keys | sort) == ["data","type"]) and
    (.type == "as") and
    ((.data | type) == "array") and
    ((.data | length) == 1) and
    ((.data[0] | type) == "array") and
    ((.data[0] | length) <= 1024) and
    ((.data[0] | unique | length) == (.data[0] | length)) and
    (all(.data[0][]; (. | type) == "string" and (utf8bytelength <= 255) and (test("^:[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$") or test("^[A-Za-z_][A-Za-z0-9_]*([.][A-Za-z_][A-Za-z0-9_]*)+$"))))
  ' <<<"$value" >/dev/null
}

strict_components_reply() {
  local value="$1"
  "$JQ_BIN" -e '
    ((keys | sort) == ["data","type"]) and
    (.type == "ao") and
    ((.data | type) == "array") and
    ((.data | length) == 1) and
    ((.data[0] | type) == "array") and
    ((.data[0] | length) <= 128) and
    ((.data[0] | unique | length) == (.data[0] | length)) and
    (all(.data[0][]; (. | type) == "string" and (utf8bytelength <= 256) and test("^(/[A-Za-z0-9_]+)+$")))
  ' <<<"$value" >/dev/null
}

strict_shortcut_reply() {
  local value="$1"
  "$JQ_BIN" -e '
    ((keys | sort) == ["data","type"]) and
    (.type == "a(ssssssaiai)") and
    ((.data | type) == "array") and
    ((.data | length) == 1) and
    ((.data[0] | type) == "array") and
    ((.data[0] | length) <= 4096) and
    all(.data[0][];
      (. | type) == "array" and (. | length) == 8 and
      all(.[0:6][]; (. | type) == "string" and utf8bytelength <= 256) and
      all(.[6:8][]; (. | type) == "array" and length <= 64 and
        all(.[]; (. | type) == "number" and floor == . and . >= -2147483648 and . <= 2147483647))
    )
  ' <<<"$value" >/dev/null
}

read_uid() {
  local line key value real effective saved count=0 raw
  raw="$(read_proc_file "$PROC_ROOT/$1/status")" || return 1
  while IFS= read -r line; do
    read -r key value real effective saved _ <<<"$line"
    if [[ "$key" == Uid: ]]; then
      [[ "$value" =~ ^[0-9]+$ && "$real" == "$value" && "$effective" == "$value" && "$saved" == "$value" ]] || return 1
      count=$((count + 1))
      [[ "$count" -eq 1 ]] || return 1
    fi
  done <<<"$raw"
  [[ "$count" -eq 1 ]] || return 1
  printf '%s\n' "$value"
}

read_start_time() {
  local line rest
  local -a fields
  line="$(read_proc_file "$PROC_ROOT/$1/stat")" || return 1
  rest="${line##*) }"
  read -r -a fields <<<"$rest"
  [[ "${#fields[@]}" -gt 19 && "${fields[19]}" =~ ^[0-9]+$ && "${fields[19]}" -gt 0 ]] || return 1
  printf '%s\n' "${fields[19]}"
}

read_process_identity() {
  local pid="$1" expected="$2" uid start exe cmdline arg session_scope=0 raw
  local -a argv=()
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || fail 'service owner PID is malformed'
  [[ -d "$PROC_ROOT/$pid" && ! -L "$PROC_ROOT/$pid" ]] || fail "owner PID $pid is unavailable"
  uid="$(read_uid "$pid")" || fail "owner PID $pid has malformed UID metadata"
  [[ "$uid" == "$CURRENT_UID" ]] || fail "owner PID $pid is not owned by the current user"
  start="$(read_start_time "$pid")" || fail "owner PID $pid has malformed start-time metadata"
  exe="$("$READLINK_BIN" -f -- "$PROC_ROOT/$pid/exe")" || fail "owner PID $pid executable could not be resolved"
  [[ "$exe" == "$expected" ]] || fail "owner PID $pid executable is not the validated $expected"
  [[ -f "$PROC_ROOT/$pid/cmdline" && ! -L "$PROC_ROOT/$pid/cmdline" ]] || fail "owner PID $pid cmdline is unavailable"
  raw="$(read_proc_file "$PROC_ROOT/$pid/cmdline" | "$TR_BIN" '\0' '\n')" || fail "owner PID $pid cmdline could not be read"
  while IFS= read -r arg; do
    [[ -n "$arg" && "${#arg}" -le 512 ]] || fail "owner PID $pid cmdline contains an invalid argument"
    argv+=("$arg")
  done <<<"$raw"
  [[ "${#argv[@]}" -ge 1 && "${#argv[@]}" -le 64 ]] || fail "owner PID $pid cmdline is malformed"
  [[ "${argv[0]}" == "$expected" ]] || fail "owner PID $pid cmdline does not identify $expected"
  cmdline="${argv[0]}"
  for arg in "${argv[@]:1}"; do cmdline+=" $arg"; done
  [[ -f "$PROC_ROOT/$pid/cgroup" && ! -L "$PROC_ROOT/$pid/cgroup" ]] || fail "owner PID $pid cgroup is unavailable"
  raw="$(read_proc_file "$PROC_ROOT/$pid/cgroup")" || fail "owner PID $pid cgroup could not be read"
  while IFS= read -r arg; do
    if [[ "$arg" =~ (^|/)session-([A-Za-z0-9_-]+)\.scope(/|$) ]]; then
      [[ "${BASH_REMATCH[2]}" == "$SESSION_ID" ]] || fail "owner PID $pid belongs to another login session"
      session_scope=$((session_scope + 1))
    fi
  done <<<"$raw"
  [[ "$session_scope" -eq 1 ]] || fail "owner PID $pid has ambiguous current-session scope"
  REPLY="$("$JQ_BIN" -cn --arg uid "$uid" --arg start "$start" --arg exe "$exe" --arg cmdline "$cmdline" '{uid:($uid|tonumber),start_time:($start|tonumber),executable:$exe,cmdline:$cmdline}')"
}

capture_service() {
  local service="$1" expected="$2" owner pid uid process
  owner="$(call_name_owner "$service")" || fail "could not resolve owner for $service"
  dbus_reply "$owner" || fail "malformed owner reply for $service"
  strict_string_reply "$REPLY" || fail "malformed owner reply for $service"
  owner="$($JQ_BIN -r '.data[0]' <<<"$REPLY")"
  [[ "$owner" =~ ^:[0-9]+\.[0-9]+$ ]] || fail "owner for $service is not a unique name"
  pid="$(call_pid "$owner")" || fail "could not resolve PID for $service"
  dbus_reply "$pid" || fail "malformed PID reply for $service"
  strict_uint_reply "$REPLY" || fail "malformed PID reply for $service"
  pid="$($JQ_BIN -r '.data[0]' <<<"$REPLY")"
  uid="$(call_uid "$owner")" || fail "could not resolve UID for $service"
  dbus_reply "$uid" || fail "malformed UID reply for $service"
  strict_uint_reply "$REPLY" || fail "malformed UID reply for $service"
  uid="$($JQ_BIN -r '.data[0]' <<<"$REPLY")"
  [[ "$uid" == "$CURRENT_UID" ]] || fail "$service owner UID differs from the current user"
  read_process_identity "$pid" "$expected"
  process="$REPLY"
  REPLY="$("$JQ_BIN" -cn --arg service "$service" --arg owner "$owner" --argjson pid "$pid" --argjson uid "$uid" --argjson process "$process" '{service:$service,owner:$owner,pid:$pid,uid:$uid,start_time:$process.start_time,executable:$process.executable,cmdline:$process.cmdline}')"
}

check_path_metadata() {
  local path="$1" metadata owner mode
  metadata="$("$STAT_BIN" -c '%u %a' -- "$path")" || fail "could not inspect path metadata: $path"
  read -r owner mode _ <<<"$metadata"
  [[ "$owner" =~ ^[0-9]+$ && "$mode" =~ ^[0-7]{3,4}$ ]] || fail "malformed path metadata: $path"
  [[ "$owner" == 0 || "$owner" == "$CURRENT_UID" ]] || fail "path component is not root- or user-owned: $path"
  (( (8#$mode & 0022) == 0 )) || fail "path component is group- or world-writable: $path"
}

check_safe_directory() {
  local path="$1" current=/ component
  local -a components=()
  [[ "$path" =~ ^/[A-Za-z0-9._/-]+$ && "$path" != *'//'* ]] || fail 'HOME/XDG config path is unsafe'
  IFS=/ read -r -a components <<<"${path#/}"
  check_path_metadata /
  for component in "${components[@]}"; do
    [[ -n "$component" && "$component" != . && "$component" != .. ]] || fail 'HOME/XDG config path contains traversal'
    if [[ "$current" == / ]]; then current="/$component"; else current="$current/$component"; fi
    [[ -d "$current" && ! -L "$current" ]] || fail "HOME/XDG config path component is missing or symlinked: $current"
    check_path_metadata "$current"
  done
}

resolve_config_path() {
  local home config_home
  home="${HOME:-}"
  [[ -n "$home" ]] || fail 'HOME is required'
  check_safe_directory "$home"
  config_home="${XDG_CONFIG_HOME:-$home/.config}"
  [[ "$config_home" == /* ]] || fail 'XDG_CONFIG_HOME must be absolute'
  check_safe_directory "$config_home"
  CONFIG_HOME="$config_home"
  CONFIG_PATH="$CONFIG_HOME/kwinrc"
  [[ ! -L "$CONFIG_PATH" ]] || fail 'KWin config path is a symlink'
  if [[ -e "$CONFIG_PATH" ]]; then
    [[ -f "$CONFIG_PATH" ]] || fail 'KWin config path is not a regular file'
    check_path_metadata "$CONFIG_PATH"
    [[ "$("$STAT_BIN" -c '%u' -- "$CONFIG_PATH")" == "$CURRENT_UID" ]] || fail 'KWin config is not owned by the current user'
  fi
}

establish_current_session() {
  local line session uid rest raw props_raw candidate_count=0
  local -a props=()
  local -A seen=()
  raw="$("$LOGINCTL_BIN" list-sessions --no-legend --no-pager)" || fail 'current login sessions could not be enumerated'
  [[ -n "$raw" && "${#raw}" -le 65536 ]] || fail 'current login sessions are unavailable or oversized'
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    read -r session uid rest <<<"$line"
    [[ "$session" =~ ^[A-Za-z0-9_-]+$ && "$uid" =~ ^[0-9]+$ && -n "$rest" ]] || fail 'login session listing is malformed'
    [[ -z "${seen[$session]+set}" ]] || fail 'login session listing contains duplicate sessions'
    seen[$session]=1
    [[ "$uid" == "$CURRENT_UID" ]] || continue
    props_raw="$("$LOGINCTL_BIN" show-session "$session" -p User -p Type -p Class -p State -p Desktop -p Leader --value --no-pager)" || fail "session properties could not be read: $session"
    mapfile -t props <<<"$props_raw"
    [[ "${#props[@]}" -eq 6 ]] || fail "session properties are malformed: $session"
    [[ "${props[0]}" == "$CURRENT_UID" && "${props[1]}" =~ ^(wayland|x11)$ && "${props[2]}" == user && "${props[3]}" == active && "${props[4]}" =~ ^(KDE|Plasma)$ && "${props[5]}" =~ ^[1-9][0-9]*$ ]] || continue
    candidate_count=$((candidate_count + 1))
    SESSION_ID="$session"
    SESSION_LEADER="${props[5]}"
  done <<<"$raw"
  [[ "$candidate_count" -eq 1 ]] || fail 'current graphical Plasma session is absent or ambiguous'
  SESSION_BUS_ADDRESS="unix:path=/run/user/$CURRENT_UID/bus"
}

discover_names() {
  local raw
  raw="$(call_list_names)" || fail 'ListNames transport failed'
  dbus_reply "$raw" || fail 'ListNames returned malformed JSON'
  strict_names_reply "$REPLY" || fail 'ListNames returned a malformed envelope or name'
  NAMES_JSON="$($JQ_BIN -c '.data[0] | map(select(startswith(":") | not))' <<<"$REPLY")"
}

has_service() {
  "$JQ_BIN" -e --arg service "$1" 'any(.[]; . == $service)' <<<"$NAMES_JSON" >/dev/null
}

check_persisted_state() {
  local line
  resolve_config_path
  if [[ -e "$CONFIG_PATH" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" =~ ^\[Tiling\] ]]; then
        fail 'stale persisted tiling state is present'
      fi
    done < "$CONFIG_PATH"
  fi
}

collect_shortcuts() {
  local raw components component rows
  raw="$(call_components)" || fail 'allComponents transport failed'
  dbus_reply "$raw" || fail 'allComponents returned malformed JSON'
  strict_components_reply "$REPLY" || fail 'allComponents returned a malformed or unknown schema'
  components="$($JQ_BIN -c '.data[0]' <<<"$REPLY")"
  COMPONENTS_JSON='[]'
  while IFS= read -r component; do
    raw="$(call_shortcut_infos "$component")" || fail "allShortcutInfos transport failed for $component"
    dbus_reply "$raw" || fail "allShortcutInfos returned malformed JSON for $component"
    strict_shortcut_reply "$REPLY" || fail "allShortcutInfos returned a malformed or unknown schema for $component"
    rows="$($JQ_BIN -c '.data[0]' <<<"$REPLY")"
    COMPONENTS_JSON="$($JQ_BIN -c --arg path "$component" --argjson rows "$rows" '. + [{path:$path,tuples:$rows}]' <<<"$COMPONENTS_JSON")"
  done < <($JQ_BIN -r '.[]' <<<"$components")
  RECORDS_JSON="$($JQ_BIN -c '[.[] | .tuples[]]' <<<"$COMPONENTS_JSON")"
}

check_shortcut_contract() {
  local action expected count owner active collision unknown
  while IFS= read -r action; do
    expected="$($JQ_BIN -c --arg action "$action" '.[$action]' <<<"$PROJECT_SHORTCUTS_JSON")"
    count="$($JQ_BIN -r --arg action "$action" '[.[] | select(.[0] == $action)] | length' <<<"$RECORDS_JSON")"
    [[ "$count" == 1 ]] || fail "shortcut ownership is incomplete or duplicated for $action"
    owner="$($JQ_BIN -r --arg action "$action" '[.[] | select(.[0] == $action)][0][2]' <<<"$RECORDS_JSON")"
    [[ "$owner" == "$EXPECTED_OWNER" ]] || fail "shortcut $action is unowned by $EXPECTED_OWNER"
    active="$($JQ_BIN -c --arg action "$action" '[.[] | select(.[0] == $action)][0][6]' <<<"$RECORDS_JSON")"
    [[ "$active" == "[$expected]" ]] || fail "shortcut drift detected for $action"
    collision="$($JQ_BIN -r --arg action "$action" --argjson expected "$expected" '[.[] | select(.[0] != $action and .[6] == [$expected])] | length' <<<"$RECORDS_JSON")"
    [[ "$collision" == 0 ]] || fail "shortcut collision detected for $action"
  done < <($JQ_BIN -r 'keys[]' <<<"$PROJECT_SHORTCUTS_JSON")
  unknown="$($JQ_BIN -r --argjson expected "$PROJECT_SHORTCUTS_JSON" '[.[] | .[0] as $id | select(($id | startswith("plasma-auto-tiler-")) and (($expected | has($id)) | not))] | length' <<<"$RECORDS_JSON")"
  [[ "$unknown" == 0 ]] || fail 'unknown project shortcut record was returned'
}

emit_plan() {
  local kwin_json kg_json shortcut_gate evidence_gate ready
  if [[ "$KG_STATUS" == verified ]]; then
    kg_json="$($JQ_BIN -cn --arg status "$KG_STATUS" --argjson pre "$KG_PRE" --argjson post "$KG_POST" --argjson components "$COMPONENTS_JSON" --argjson tuples "$RECORDS_JSON" '{status:$status,pre:$pre,post:$post,components:$components,exact_tuples:$tuples}')"
    shortcut_gate=verified
  else
    kg_json="$($JQ_BIN -cn --arg status "$KG_STATUS" --arg diagnostic "$KG_DIAGNOSTIC" '{status:$status,diagnostic:$diagnostic,components:[],exact_tuples:[]}')"
    shortcut_gate=unavailable
  fi
  kwin_json="$($JQ_BIN -cn --argjson pre "$KWIN_PRE" --argjson post "$KWIN_POST" '{pre:$pre,post:$post,drift:false}')"
  evidence_gate=incomplete-for-live-acceptance
  ready=false
  "$JQ_BIN" -cn \
    --arg schema "$SCHEMA_VERSION" \
    --arg command_allowlist "$COMMAND_ALLOWLIST" \
    --argjson services "$NAMES_JSON" \
    --argjson kwin "$kwin_json" \
    --argjson kglobalaccel "$kg_json" \
    --arg persisted "$PERSISTED_STATE" \
    --arg shortcut_gate "$shortcut_gate" \
    --arg evidence_gate "$evidence_gate" \
    --argjson ready "$ready" \
    --argjson project_shortcuts "$PROJECT_SHORTCUTS_JSON" \
    '{schema_version:$schema,status:"preflight-complete",live_acceptance:false,authoritative_ready:$ready,command_allowlist:($command_allowlist|split(",")),current_host_discovery:{session:"current-user-session",services:$services,kwin:$kwin,kglobalaccel:$kglobalaccel,persisted_tiling_state:$persisted},gates:{protected_window_identity:"not-assessed",persisted_scope:(if $persisted == "clean" then "clean" else "rejected" end),controller_identity:"not-assessed",shortcut_ownership_collision:$shortcut_gate,evidence:$evidence_gate},prospective_future_plan:{scope:{selection:"fresh-owned-scope",reuse_persistent_scope:false,reject_unowned_or_stale:true},exact_prestate:["protected window identity and ambiguity result","fresh scope ownership and empty-state proof","KWin/controller PID, UID, start time, executable, and cmdline","all relevant tile roots, handles, outputs, desktops, and window memberships"],journal:{scope:"same authoritative KWin/controller PID",fresh_cursor:true,retain_raw_until_verification:true},structural_calls:{re_resolve_after_each:["tile handles","tile root","authoritative decoded state"],batches:"homogeneous only",remove_then_split:"forbidden",timer_barriers:"forbidden"},interruption:{stop:"stop immediately and refuse further structural calls",rollback:"rollback only exact journaled writes in reverse dependency order",verification:"exact post-rollback state and identity must match prestate"},evidence:{raw_host_policy:"preflight persists no raw host evidence; a later authorized run retains only bounded exact evidence required for rollback verification",incomplete:"fail closed"},later_automatable_actions:["select and prove a fresh owned scope","capture exact prestate","perform homogeneous structural batches with re-resolution","verify exact rollback"],user_physical_actions:["physical drag input","physical observation of resulting layout"],manual_input:{allowed_only_after_authoritative_ready:true,currently_allowed:false},project_shortcut_defaults:$project_shortcuts}}'
}

emit_plan_v2() {
  local kwin_json kg_json shortcut_gate evidence_gate ready session_json plan_json
  if [[ "$KG_STATUS" == verified ]]; then
    kg_json="$($JQ_BIN -cn --arg status "$KG_STATUS" --argjson pre "$KG_PRE" --argjson post "$KG_POST" --argjson components "$COMPONENTS_JSON" --argjson tuples "$RECORDS_JSON" '{status:$status,pre:$pre,post:$post,components:$components,exact_tuples:$tuples}')"
    shortcut_gate=verified
  else
    kg_json="$($JQ_BIN -cn --arg status "$KG_STATUS" --arg diagnostic "$KG_DIAGNOSTIC" '{status:$status,diagnostic:$diagnostic,components:[],exact_tuples:[]}')"
    shortcut_gate=unavailable
  fi
  kwin_json="$($JQ_BIN -cn --argjson pre "$KWIN_PRE" --argjson post "$KWIN_POST" '{pre:$pre,post:$post,drift:false}')"
  session_json="$($JQ_BIN -cn --arg id "$SESSION_ID" --argjson uid "$CURRENT_UID" --argjson leader "$SESSION_LEADER" --arg address "$SESSION_BUS_ADDRESS" '{id:$id,uid:$uid,leader:$leader,bus_address:$address}')"
  evidence_gate=incomplete-for-live-acceptance
  ready=false
  plan_json="$($JQ_BIN -cn --arg config_path "$CONFIG_PATH" --argjson owner "$KWIN_PRE" --argjson project_shortcuts "$PROJECT_SHORTCUTS_JSON" '{
    scope:{selection:"fresh-owned-scope",reuse_persistent_scope:false,reject_unowned_or_stale:true,resolved_private_root:{path:"resolved only by a later authorized run",owner_uid:"current UID exactly",mode:"0700 exactly",symlink:false}},
    prestate:{config:{exact_path:$config_path,kwinrc:{before:{sha256:"capture exact SHA-256 before any write",mtime_ns:"capture exact nanosecond mtime before any write"},after:{sha256:"capture exact SHA-256 after rollback",mtime_ns:"capture exact nanosecond mtime after rollback"}}},owned_resource:{identity:$owner,scope_owner:"same authoritative KWin/controller PID, UID, start time, executable, cmdline and session scope",cleanup:"only exact handles and paths journaled by this run"},protected_window_identity:"capture identity and ambiguity result",tile_state:"capture all relevant tile roots, handles, outputs, desktops and window memberships"},
    journal:{format:"atomic journal with sequence, operation, exact owned resource identity and expected pre/post state",location:"fresh private root owned by this run",evidence:"retain bounded exact rollback and verification evidence until completion",fresh_cursor:true},
    structural_calls:{re_resolve_after_each:["tile handles","tile root","authoritative decoded state"],batches:"homogeneous only",remove_then_split:"forbidden",timer_barriers:"forbidden"},
    interruption:{stop:"stop immediately and refuse further structural calls",rollback:"rollback only exact owned journal entries in reverse dependency order",verification:"exact post-rollback state, identity, SHA-256 and nanosecond mtime must match prestate",cleanup:"never remove resources not owned by this run"},
    evidence:{raw_host_policy:"preflight persists no raw host evidence; an authorized run retains only bounded exact evidence required for rollback verification",retained:"atomic journal and exact before/after hashes, nanosecond mtimes and owned-resource identities",incomplete:"fail closed"},
    later_automatable_actions:["select and prove a fresh owned scope","capture exact prestate","perform homogeneous structural batches with re-resolution","verify exact rollback"],user_physical_actions:["physical drag input","physical observation of resulting layout"],manual_input:{allowed_only_after_authoritative_ready:true,currently_allowed:false},project_shortcut_defaults:$project_shortcuts
  }')"
  "$JQ_BIN" -cn \
    --arg schema "$SCHEMA_VERSION" --arg command_allowlist "$COMMAND_ALLOWLIST" \
    --argjson services "$NAMES_JSON" --argjson session "$session_json" --argjson kwin "$kwin_json" \
    --argjson kglobalaccel "$kg_json" --arg persisted "$PERSISTED_STATE" \
    --arg shortcut_gate "$shortcut_gate" --arg evidence_gate "$evidence_gate" \
    --argjson ready "$ready" --argjson plan "$plan_json" \
    '{schema_version:$schema,status:"preflight-complete",live_acceptance:false,authoritative_ready:$ready,readiness_blocker:"controller_checkout_identity unavailable: no supported authoritative read-only interface binds the loaded controller/script to this checkout",command_allowlist:($command_allowlist|split(",")),current_host_discovery:{session:$session,services:$services,kwin:$kwin,kwin_service_identity:$kwin,controller_checkout_identity:{status:"blocked",authoritative:false,blocker:"no-supported-authoritative-read-only-binding-to-this-checkout"},kglobalaccel:$kglobalaccel,persisted_tiling_state:$persisted},gates:{protected_window_identity:"not-assessed",persisted_scope:(if $persisted == "clean" then "clean" else "rejected" end),controller_identity:"not-established",kwin_service_identity:"verified-session-scoped-service-owner",controller_checkout_identity:"blocked",readiness:"blocked-controller-checkout-identity",shortcut_ownership_collision:$shortcut_gate,evidence:$evidence_gate},prospective_future_plan:$plan}'
}

preflight() {
  [[ -d "$PROC_ROOT" && ! -L "$PROC_ROOT" ]] || fail 'process metadata root is unavailable'
  BUSCTL_BIN="$(resolve_tool busctl)"
  JQ_BIN="$(resolve_tool jq)"
  LOGINCTL_BIN="$(resolve_tool loginctl)"
  PYTHON_BIN="$(resolve_tool python3)"
  READLINK_BIN="$(resolve_tool readlink)"
  STAT_BIN="$(resolve_tool stat)"
  TR_BIN="$(resolve_tool tr)"
  KWIN_BIN="$(resolve_tool kwin_wayland)"
  KWIN_BIN="$("$READLINK_BIN" -f -- "$KWIN_BIN")" || fail 'validated KWin executable could not be resolved'
  CURRENT_UID="$(read_uid self)" || fail 'current user UID could not be read'
  [[ "$CURRENT_UID" =~ ^[0-9]+$ ]] || fail 'current user UID is malformed'
  establish_current_session
  check_persisted_state
  discover_names
  has_service "$KWIN_SERVICE" || fail 'current KWin service is not available'
  capture_service "$KWIN_SERVICE" "$KWIN_BIN"
  KWIN_PRE="$REPLY"
  if has_service "$KG_SERVICE"; then
    KG_BIN="$(resolve_optional_tool kglobalacceld)"
    [[ -n "$KG_BIN" ]] || KG_BIN="$(resolve_optional_tool kglobalaccel5)"
    [[ -n "$KG_BIN" ]] || KG_BIN="$(resolve_optional_tool kglobalaccel6)"
    [[ -n "$KG_BIN" ]] || KG_BIN="$(resolve_optional_tool kglobalaccel)"
    [[ -n "$KG_BIN" ]] || fail 'KGlobalAccel is present but has no validated known executable'
    KG_BIN="$("$READLINK_BIN" -f -- "$KG_BIN")" || fail 'validated KGlobalAccel executable could not be resolved'
    capture_service "$KG_SERVICE" "$KG_BIN"
    KG_PRE="$REPLY"
    collect_shortcuts
    check_shortcut_contract
    KG_STATUS=verified
    KG_DIAGNOSTIC="complete all-components and exact allShortcutInfos enumeration"
  fi
  discover_names
  has_service "$KWIN_SERVICE" || fail 'current KWin service disappeared during preflight'
  capture_service "$KWIN_SERVICE" "$KWIN_BIN"
  KWIN_POST="$REPLY"
  [[ "$KWIN_PRE" == "$KWIN_POST" ]] || fail 'KWin service/PID/UID/start-time/executable/cmdline drift detected'
  if [[ "$KG_STATUS" == verified ]]; then
    has_service "$KG_SERVICE" || fail 'KGlobalAccel service drifted during enumeration'
    capture_service "$KG_SERVICE" "$KG_BIN"
    KG_POST="$REPLY"
    [[ "$KG_PRE" == "$KG_POST" ]] || fail 'KGlobalAccel service/PID/UID/start-time/executable/cmdline drift detected'
  elif has_service "$KG_SERVICE"; then
    fail 'KGlobalAccel availability drifted during preflight'
  fi
  emit_plan_v2
}

if [[ "$#" -ne 1 ]]; then usage >&2; exit 1; fi
case "$1" in
  --help|-h) usage ;;
  preflight) preflight ;;
  *) fail "unknown command '$1'" ;;
esac
