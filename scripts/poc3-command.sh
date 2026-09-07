#!/usr/bin/env bash
# POC3 one-shot command lifecycle interface (dedicated, bounded, command-scoped).
#
# Runs exactly one POC3 command (start | focus <direction> | move <direction>
# | status | stop) as a separately bundled IIFE with an embedded validated
# config: strictly parse fixed args (no shell evaluation), build the bundle
# via scripts/poc3-build-command.mjs, load and run it under the namespaced
# plugin id `poc3-manual-command`, wait boundedly for its
# `poc3-command-done:<nonce>` diagnostic bound to the current KWin PID, then
# unload the exact returned script id and verify not-loaded.
#
# Each loaded command revalidates the exact supplied IDs/scope before use and
# talks to the Rust service; there is no generic command execution, no global
# shortcut, no normal startup, no persistence/autostart, no config mutation,
# and no source-text evaluation (bundles are files loaded by path only).
#
# Coexistence guard: every subcommand refuses when the production plugin
# (`plasma-auto-tiler-kwin`) is loaded, without unloading or modifying it.
# Running a command therefore requires a nested/private environment or an
# unloaded production plugin as an explicit prerequisite. Closure-only route: start embeds the literal `close-disposable`
# cleanup model and stop never confirms restore; restore is omitted from this
# route by construction (no envelopes survive across separately loaded
# bundles). Reference continuity across separately loaded bundles does not
# exist; within one command every actuation is reference-pinned and observed.
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
KWIN_DIR="$REPO_ROOT/kwin"
BUILD_HELPER="$REPO_ROOT/scripts/poc3-build-command.mjs"
BUNDLE="$KWIN_DIR/dist/poc3-manual-command.js"
PLUGIN="poc3-manual-command"
PRODUCTION_PLUGIN="plasma-auto-tiler-kwin"
: "${NESTED_MANIFEST_SH:=$REPO_ROOT/scripts/nested-kwin-manifest.sh}"
: "${POC3_NESTED_ALLOW:=0}"
: "${POC3_HOST_ALLOW:=0}"

BUS_SCOPE="--user"
BUS_DEST="org.kde.KWin"
BUS_PATH="/Scripting"
BUS_SCRIPTING_IFACE="org.kde.kwin.Scripting"
BUS_SCRIPT_IFACE="org.kde.kwin.Script"

SCRIPT_ID=""
KWIN_PID=""
JOURNAL_CURSOR=""
DONE_TOKEN=""

READINESS_ATTEMPTS=150
READINESS_DELAY=0.1

isloaded_valid='((keys | sort) == ["data","type"]) and (.type == "b") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "boolean")'
load_valid='((keys | sort) == ["data","type"]) and (.type == "i") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "number") and ((.data[0] | floor) == .data[0]) and ((.data[0] >= 0) and (.data[0] <= 2147483647))'
script_iface_valid='type == "array" and any(.[]; ((.type == "interface") and (.name == "org.kde.kwin.Script")))'
unload_valid="$isloaded_valid"
dbus_pid_valid='((keys | sort) == ["data","type"]) and (.type == "u") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "number") and ((.data[0] | floor) == .data[0]) and ((.data[0] | tostring | test("^[1-9][0-9]*$"))) and (.data[0] > 0) and (.data[0] <= 4294967295)'
dbus_string_valid='((keys | sort) == ["data","type"]) and (.type == "s") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "string") and ((.data[0] | length) > 0)'
done_valid='any(.[]; ((._PID? // "") == $pid) and ((.MESSAGE? | type) == "string") and (.MESSAGE | contains($done)))'

usage() {
  cat <<'EOF'
usage: poc3-command.sh <command> [args] [--help]

One-shot POC3 command runner. Each invocation builds, loads, runs, and
unloads exactly one command bundle.

Commands:
  start <id1> <id2> <id3> --owner O --generation G --nonce N [--gap N] [--usable x,y,w,h]
  focus <direction> <id1> <id2> <id3> --owner O --generation G --revision R --nonce N
  move <direction> <id1> <id2> <id3> --owner O --generation G --revision R --nonce N
  status --owner O --generation G --nonce N
  stop <id1> <id2> <id3> --owner O --generation G --revision R --nonce N
   nested WORKDIR <command> [args...]
   nested WORKDIR persistent-cleanup
   --help          show this help and exit

   Nested route (disabled by default, set POC3_NESTED_ALLOW=1 to enable):
   nested WORKDIR start|focus|move|status|stop ... validates WORKDIR/manifest
   first, uses only the manifest private bus address and recorded log, then
   re-validates private state again before transport.
    nested WORKDIR start --owner O --generation G --nonce N [--gap N]
    (no window IDs, no --usable) is the persistent direct-enrollment
    pivot: a generated persistent test-only adapter discovers the exact three
    internal IDs itself from manifest-bound manual-PID evidence, derives
    usable area from the observed native output, performs the
    initial start only, routes every EvaluatePoc3 request to the exact
    planner D-Bus unique owner resolved on the private bus immediately
    before build/load (no well-known fallback), and stays loaded with its
    exact plugin/script-id retained in the manifest for persistent-cleanup.
    No ID probe runs on this path. Initial start only: focus/move/stop have
    no direct-enrollment form and still require the legacy three-ID route
    below.

IDs are exactly three explicitly supplied String(Window.internalId) values
(opaque or canonical QUuid forms). The session token (--owner/--generation)
binds the engine session across separately loaded commands; --revision pins
the expected engine revision where needed. --nonce is a bounded token echoed
only in the completion diagnostic used to match this invocation.

Host route (disabled by default, set POC3_HOST_ALLOW=1 to enable):
  start|focus|move|status|stop target the host session bus and journal.
  Without the opt-in the host route refuses before any transport.

 Safety:
    Refuses every subcommand while the production plugin
    plasma-auto-tiler-kwin is loaded (read-only check, never unloads it).
   Closure-only route: no restore flag exists; stop never confirms restore.
   Fixed plugin id poc3-manual-command and fixed dist bundle path only.
   Bounded wait for poc3-command-done:<nonce>, then exact-ID unload verified
   not-loaded. Loading/running mutates live KWin state and still requires
   explicit authorization.
     Persistent enroll-start authority is the captured D-Bus run reply plus
     the service-backed typed EvaluatePoc3 status/complete acknowledgement
     to the exact planner unique owner plus adapter-side post-observation of
     the KWin adapter's complete acknowledgement and its own observed
     convergence; KWin print/log markers are never success authority on that
     path. The persistent adapter stays loaded by design;
     persistent-cleanup unloads the exact manifest-recorded plugin/script-id
     (Script0 valid, no caller ID, no log-marker authority; the KWin
     Scripting API exposes no plugin identity on /Scripting/ScriptN, so only
     the exact retained plugin plus returned ID plus introspection plus
     loaded check bind cleanup), retains the enroll record until the
     manifest-bound trio close verifies, and on close failure reports unload
     verified/trio pending for retry without a second unload.
EOF
}

require_tools() {
  local tool
  for tool in "$@"; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "error: required tool '$tool' not found in PATH" >&2
      exit 1
    fi
  done
}

strict_json_matches() {
  local predicate="$1" value="$2"
  jq -s -e "length == 1 and (.[0] | $predicate)" <<<"$value" >/dev/null 2>&1
}

valid_id() {
  local id="$1"
  [[ -n "$id" && ${#id} -le 128 ]] || return 1
  if [[ "$id" =~ ^[A-Za-z0-9._-]+$ ]]; then return 0; fi
  if [[ "$id" =~ ^\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}$ ]]; then return 0; fi
  if [[ "$id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then return 0; fi
  return 1
}

valid_owner() { [[ "$1" =~ ^[A-Za-z0-9._-]{1,128}$ ]]; }
valid_token() { [[ "$1" =~ ^[a-z0-9-]{1,64}$ ]]; }
valid_revision() { [[ "$1" =~ ^[0-9]+$ ]] && [[ "$1" -le 1000000 ]]; }
valid_gap() { [[ "$1" =~ ^[0-9]+$ ]] && [[ "$1" -le 64 ]]; }
valid_usable() { [[ "$1" =~ ^-?[0-9]+,-?[0-9]+,[0-9]+,[0-9]+$ ]]; }
valid_direction() {
  [[ "$1" == left || "$1" == right || "$1" == up || "$1" == down ]]
}

loaded_word() {
  local plugin="$1" out
  out="$(busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE isScriptLoaded s "$plugin")" || {
    echo "error: isScriptLoaded call failed for '$plugin': $out" >&2
    return 1
  }
  strict_json_matches "$isloaded_valid" "$out" || {
    echo "error: unexpected isScriptLoaded reply for '$plugin': $out" >&2
    return 1
  }
  if [[ "$(jq -r '.data[0]' <<<"$out")" == "true" ]]; then
    printf 'loaded\n'
  else
    printf 'not-loaded\n'
  fi
}

refuse_when_production_loaded() {
  local production
  production="$(loaded_word "$PRODUCTION_PLUGIN")" || exit 1
  if [[ "$production" == loaded ]]; then
    echo "error: production plugin '$PRODUCTION_PLUGIN' is loaded; refusing POC3 command operation" >&2
    echo "use a nested/private environment or unload the production plugin first" >&2
    exit 1
  fi
}

find_kwin_pid() {
  local owner_out owner pid_out pid
  owner_out="$(busctl $BUS_SCOPE --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s "$BUS_DEST")" || return 1
  strict_json_matches "$dbus_string_valid" "$owner_out" || return 1
  owner="$(jq -r '.data[0]' <<<"$owner_out")"
  [[ "$owner" =~ ^:[0-9]+\.[0-9]+$ ]] || return 1
  pid_out="$(busctl $BUS_SCOPE --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetConnectionUnixProcessID s "$owner")" || return 1
  strict_json_matches "$dbus_pid_valid" "$pid_out" || return 1
  pid="$(jq -r '.data[0]' <<<"$pid_out")"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s\n' "$pid"
}

exact_cleanup() {
  local id="$1" out after
  [[ "$id" =~ ^[0-9]+$ && "$id" -le 2147483647 ]] || return 1
  busctl $BUS_SCOPE call "$BUS_DEST" "/Scripting/Script$id" $BUS_SCRIPT_IFACE stop >/dev/null 2>&1 || true
  out="$(busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE unloadScript s "$PLUGIN" 2>/dev/null)" || return 1
  strict_json_matches "$unload_valid" "$out" || return 1
  [[ "$(jq -r '.data[0]' <<<"$out")" == true ]] || return 1
  after="$(loaded_word "$PLUGIN")" || return 1
  [[ "$after" == not-loaded ]] || return 1
}

cleanup_loaded() {
  [[ -n "$SCRIPT_ID" ]] || return 1
  exact_cleanup "$SCRIPT_ID"
}

signal_during_command() {
  local sig="$1" cleanup_state=unverified
  if [[ -n "$SCRIPT_ID" ]] && cleanup_loaded; then cleanup_state=verified; fi
  printf 'command: partial script-id=%s cleanup=%s\n' "${SCRIPT_ID:-unknown}" "$cleanup_state" >&2
  trap - INT TERM
  kill -"$sig" "$$"
}

# Parse the fixed per-command argv into helper args. No shell evaluation:
# fixed positional order, allowlisted --flag names, regex-validated values.
parse_command_args() {
  HELPER_ARGS=()
  local cmd="$1"
  shift
  case "$cmd" in
    start)
      [[ $# -ge 3 ]] || { echo "error: start requires three window ids" >&2; exit 1; }
      local a="$1" b="$2" c="$3"
      shift 3
      valid_id "$a" && valid_id "$b" && valid_id "$c" || { echo "error: invalid window id" >&2; exit 1; }
      [[ "$a" != "$b" && "$a" != "$c" && "$b" != "$c" ]] || { echo "error: window ids must be unique" >&2; exit 1; }
      HELPER_ARGS+=(--command start --id "$a" --id "$b" --id "$c")
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --owner) valid_owner "${2:-}" || { echo "error: invalid --owner" >&2; exit 1; }; HELPER_ARGS+=(--owner "$2"); shift 2 ;;
          --generation) valid_token "${2:-}" || { echo "error: invalid --generation" >&2; exit 1; }; HELPER_ARGS+=(--generation "$2"); shift 2 ;;
          --nonce) valid_token "${2:-}" || { echo "error: invalid --nonce" >&2; exit 1; }; DONE_TOKEN="$2"; HELPER_ARGS+=(--nonce "$2"); shift 2 ;;
          --gap) valid_gap "${2:-}" || { echo "error: invalid --gap" >&2; exit 1; }; HELPER_ARGS+=(--gap "$2"); shift 2 ;;
          --usable) valid_usable "${2:-}" || { echo "error: invalid --usable" >&2; exit 1; }; HELPER_ARGS+=(--usable "$2"); shift 2 ;;
          *) echo "error: unknown start flag '$1'" >&2; exit 1 ;;
        esac
      done
      ;;
    focus|move)
      [[ $# -ge 4 ]] || { echo "error: $cmd requires a direction and three window ids" >&2; exit 1; }
      local dir="$1" a="$2" b="$3" c="$4"
      shift 4
      valid_direction "$dir" || { echo "error: invalid direction" >&2; exit 1; }
      valid_id "$a" && valid_id "$b" && valid_id "$c" || { echo "error: invalid window id" >&2; exit 1; }
      [[ "$a" != "$b" && "$a" != "$c" && "$b" != "$c" ]] || { echo "error: window ids must be unique" >&2; exit 1; }
      HELPER_ARGS+=(--command "$cmd" --direction "$dir" --id "$a" --id "$b" --id "$c")
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --owner) valid_owner "${2:-}" || { echo "error: invalid --owner" >&2; exit 1; }; HELPER_ARGS+=(--owner "$2"); shift 2 ;;
          --generation) valid_token "${2:-}" || { echo "error: invalid --generation" >&2; exit 1; }; HELPER_ARGS+=(--generation "$2"); shift 2 ;;
          --revision) valid_revision "${2:-}" || { echo "error: invalid --revision" >&2; exit 1; }; HELPER_ARGS+=(--revision "$2"); shift 2 ;;
          --nonce) valid_token "${2:-}" || { echo "error: invalid --nonce" >&2; exit 1; }; DONE_TOKEN="$2"; HELPER_ARGS+=(--nonce "$2"); shift 2 ;;
          *) echo "error: unknown $cmd flag '$1'" >&2; exit 1 ;;
        esac
      done
      ;;
    status)
      HELPER_ARGS+=(--command status)
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --owner) valid_owner "${2:-}" || { echo "error: invalid --owner" >&2; exit 1; }; HELPER_ARGS+=(--owner "$2"); shift 2 ;;
          --generation) valid_token "${2:-}" || { echo "error: invalid --generation" >&2; exit 1; }; HELPER_ARGS+=(--generation "$2"); shift 2 ;;
          --nonce) valid_token "${2:-}" || { echo "error: invalid --nonce" >&2; exit 1; }; DONE_TOKEN="$2"; HELPER_ARGS+=(--nonce "$2"); shift 2 ;;
          *) echo "error: unknown status flag '$1'" >&2; exit 1 ;;
        esac
      done
      ;;
    stop)
      [[ $# -ge 3 ]] || { echo "error: stop requires three window ids" >&2; exit 1; }
      local a="$1" b="$2" c="$3"
      shift 3
      valid_id "$a" && valid_id "$b" && valid_id "$c" || { echo "error: invalid window id" >&2; exit 1; }
      [[ "$a" != "$b" && "$a" != "$c" && "$b" != "$c" ]] || { echo "error: window ids must be unique" >&2; exit 1; }
      HELPER_ARGS+=(--command stop --id "$a" --id "$b" --id "$c")
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --owner) valid_owner "${2:-}" || { echo "error: invalid --owner" >&2; exit 1; }; HELPER_ARGS+=(--owner "$2"); shift 2 ;;
          --generation) valid_token "${2:-}" || { echo "error: invalid --generation" >&2; exit 1; }; HELPER_ARGS+=(--generation "$2"); shift 2 ;;
          --revision) valid_revision "${2:-}" || { echo "error: invalid --revision" >&2; exit 1; }; HELPER_ARGS+=(--revision "$2"); shift 2 ;;
          --nonce) valid_token "${2:-}" || { echo "error: invalid --nonce" >&2; exit 1; }; DONE_TOKEN="$2"; HELPER_ARGS+=(--nonce "$2"); shift 2 ;;
          *) echo "error: unknown stop flag '$1'" >&2; exit 1 ;;
        esac
      done
      ;;
    *)
      echo "error: unknown command '$cmd'" >&2
      exit 1
      ;;
  esac
  # Required flags per command (checked structurally, never evaluated).
  case "$cmd" in
    start) need_flags=(--owner --generation --nonce) ;;
    focus|move|stop) need_flags=(--owner --generation --revision --nonce) ;;
    status) need_flags=(--owner --generation --nonce) ;;
  esac
  local need
  for need in "${need_flags[@]}"; do
    local present=0 entry
    for entry in "${HELPER_ARGS[@]}"; do [[ "$entry" == "$need" ]] && present=1; done
    [[ "$present" == 1 ]] || { echo "error: $cmd requires $need" >&2; exit 1; }
  done
}

# NESTED-ONLY ROUTE BEGIN
# Explicit nested-only POC3 transport. Requires POC3_NESTED_ALLOW=1,
# a validated WORKDIR manifest, and the manifest private bus address plus
# recorded log. Uses an explicit address on every call and reads only the
# private log. Fails closed on any missing or mismatched private state.
NESTED_WORKDIR=""
NESTED_BUS_ADDRESS=""
NESTED_BUS_PATH=""
NESTED_LOG_PATH=""
NESTED_KWIN_PID=""

nested_require_enabled() {
  [[ "${POC3_NESTED_ALLOW:-0}" == 1 ]] || {
    echo "error: nested POC3 command transport is disabled by default (set POC3_NESTED_ALLOW=1 to enable)" >&2
    exit 1
  }
}

nested_safe_abs() {
  local path="$1"
  [[ "$path" == /* && "$path" != *'//' && "$path" != *'/../'* \
    && "$path" != */.. && "$path" != */./* && "$path" != */. ]] || return 1
  [[ "$path" != "/" ]] || return 1
}

nested_bus_binds_workdir() {
  local bus="$1" workdir="$2" host_runtime="$3"
  [[ -n "$bus" && -n "$workdir" && -n "$host_runtime" ]] || return 1
  [[ "$bus" != *"$host_runtime"* ]] || return 1
  local IFS=';'
  local -a _entries=()
  read -r -a _entries <<<"$bus" || return 1
  [[ "${#_entries[@]}" -ge 1 ]] || return 1
  local found_path=0 entry rest kv val
  for entry in "${_entries[@]}"; do
    [[ -n "$entry" ]] || return 1
    [[ "$entry" == unix:* ]] || return 1
    rest="${entry#unix:}"
    [[ -n "$rest" ]] || return 1
    local IFS=','
    local -a _kvs=()
    read -r -a _kvs <<<"$rest" || return 1
    for kv in "${_kvs[@]}"; do
      case "$kv" in
        path=*|abstract=*)
          val="${kv#*=}"
          [[ -n "$val" ]] || return 1
          nested_safe_abs "$val" || return 1
          if [[ "$val" == "$workdir" || "$val" == "$workdir"/* ]]; then
            found_path=1
          else
            return 1
          fi
          ;;
      esac
    done
  done
  [[ "$found_path" -eq 1 ]] || return 1
}

nested_manifest_get() {
  local file="$1" key="$2"
  local line
  line="$(grep -E -m 1 "^${key}=" -- "$file" 2>/dev/null)" || return 1
  printf '%s' "${line#*=}"
}

nested_validate_manifest() {
  local workdir="$1"
  [[ -n "$workdir" ]] || { echo "error: nested WORKDIR is empty" >&2; return 1; }
  [[ -f "$NESTED_MANIFEST_SH" && ! -L "$NESTED_MANIFEST_SH" ]] || {
    echo "error: nested manifest helper is unavailable" >&2
    return 1
  }
  bash "$NESTED_MANIFEST_SH" validate "$workdir" >&2 || {
    echo "error: nested manifest validation failed for '$workdir'" >&2
    return 1
  }
}

nested_load_private_state() {
  local workdir="$1" manifest bus_address bus_path log_path host_runtime
  manifest="$workdir/manifest"
  [[ -f "$manifest" && ! -L "$manifest" ]] || {
    echo "error: nested manifest file is absent or symlinked" >&2
    return 1
  }
  bus_address="$(nested_manifest_get "$manifest" bus_address)" || {
    echo "error: nested manifest is missing bus_address" >&2
    return 1
  }
  bus_path="$(nested_manifest_get "$manifest" bus_path)" || {
    echo "error: nested manifest is missing bus_path" >&2
    return 1
  }
  log_path="$(nested_manifest_get "$manifest" log_path)" || {
    echo "error: nested manifest is missing log_path" >&2
    return 1
  }
  host_runtime="$(nested_manifest_get "$manifest" host_runtime)" || {
    echo "error: nested manifest is missing host_runtime" >&2
    return 1
  }
  [[ -n "$bus_address" ]] || { echo "error: nested private bus address is empty" >&2; return 1; }
  nested_safe_abs "$host_runtime" || { echo "error: nested host runtime is unsafe" >&2; return 1; }
  if [[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" && "$bus_address" == "${DBUS_SESSION_BUS_ADDRESS}" ]]; then
    echo "error: nested private bus reuses the host session bus" >&2
    return 1
  fi
  nested_bus_binds_workdir "$bus_address" "$workdir" "$host_runtime" || { echo "error: nested private bus address does not bind to this WORKDIR (or references the host runtime)" >&2; return 1; }
  nested_safe_abs "$bus_path" || { echo "error: nested bus_path is unsafe" >&2; return 1; }
  [[ "$bus_path" == "$workdir"/* ]] || { echo "error: nested bus_path escapes the WORKDIR" >&2; return 1; }
  [[ -f "$bus_path" && ! -L "$bus_path" ]] || { echo "error: nested private bus file is absent" >&2; return 1; }
  local bus_file_content
  bus_file_content="$(cat -- "$bus_path" 2>/dev/null)" || { echo "error: nested private bus file is unreadable" >&2; return 1; }
  [[ -n "$bus_file_content" ]] || { echo "error: nested private bus file is empty" >&2; return 1; }
  [[ "$bus_file_content" == "$bus_address" ]] || { echo "error: nested private bus file does not match the manifest address" >&2; return 1; }
  nested_safe_abs "$log_path" || { echo "error: nested log_path is unsafe" >&2; return 1; }
  [[ "$log_path" == "$workdir"/* ]] || { echo "error: nested log_path escapes the WORKDIR" >&2; return 1; }
  [[ -f "$log_path" && ! -L "$log_path" ]] || { echo "error: nested private log is absent" >&2; return 1; }
  NESTED_BUS_ADDRESS="$bus_address"
  NESTED_BUS_PATH="$bus_path"
  NESTED_LOG_PATH="$log_path"
  NESTED_WORKDIR="$workdir"
}

nested_loaded_word() {
  local plugin="$1" out
  out="$(busctl --address="$NESTED_BUS_ADDRESS" --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE isScriptLoaded s "$plugin")" || {
    echo "error: isScriptLoaded call failed for '$plugin': $out" >&2
    return 1
  }
  strict_json_matches "$isloaded_valid" "$out" || {
    echo "error: unexpected isScriptLoaded reply for '$plugin': $out" >&2
    return 1
  }
  if [[ "$(jq -r '.data[0]' <<<"$out")" == "true" ]]; then
    printf 'loaded\n'
  else
    printf 'not-loaded\n'
  fi
}

nested_refuse_when_production_loaded() {
  local production
  production="$(nested_loaded_word "$PRODUCTION_PLUGIN")" || exit 1
  if [[ "$production" == loaded ]]; then
    echo "error: production plugin '$PRODUCTION_PLUGIN' is loaded in the nested instance; refusing POC3 command operation" >&2
    exit 1
  fi
}

nested_find_kwin_pid() {
  local owner_out owner pid_out pid manifest_pid
  owner_out="$(busctl --address="$NESTED_BUS_ADDRESS" --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s "$BUS_DEST")" || return 1
  strict_json_matches "$dbus_string_valid" "$owner_out" || return 1
  owner="$(jq -r '.data[0]' <<<"$owner_out")"
  [[ "$owner" =~ ^:[0-9]+\.[0-9]+$ ]] || return 1
  pid_out="$(busctl --address="$NESTED_BUS_ADDRESS" --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetConnectionUnixProcessID s "$owner")" || return 1
  strict_json_matches "$dbus_pid_valid" "$pid_out" || return 1
  pid="$(jq -r '.data[0]' <<<"$pid_out")"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  manifest_pid="$(nested_manifest_get "$NESTED_WORKDIR/manifest" nested_pid)" || {
    echo "error: nested manifest is missing nested_pid" >&2
    return 1
  }
  [[ "$pid" == "$manifest_pid" ]] || {
    echo "error: nested KWin PID $pid does not match manifest nested_pid $manifest_pid" >&2
    return 1
  }
  printf '%s\n' "$pid"
}

nested_exact_cleanup() {
  local id="$1" out after
  [[ "$id" =~ ^[0-9]+$ && "$id" -le 2147483647 ]] || return 1
  busctl --address="$NESTED_BUS_ADDRESS" call "$BUS_DEST" "/Scripting/Script$id" $BUS_SCRIPT_IFACE stop >/dev/null 2>&1 || true
  out="$(busctl --address="$NESTED_BUS_ADDRESS" --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE unloadScript s "$PLUGIN" 2>/dev/null)" || return 1
  strict_json_matches "$unload_valid" "$out" || return 1
  [[ "$(jq -r '.data[0]' <<<"$out")" == true ]] || return 1
  after="$(nested_loaded_word "$PLUGIN")" || return 1
  [[ "$after" == not-loaded ]] || return 1
}

nested_cleanup_loaded() {
  [[ -n "$SCRIPT_ID" ]] || return 1
  nested_exact_cleanup "$SCRIPT_ID"
}

nested_signal_during_command() {
  local sig="$1" cleanup_state=unverified
  if [[ -n "$SCRIPT_ID" ]] && nested_cleanup_loaded; then cleanup_state=verified; fi
  printf 'command: partial script-id=%s cleanup=%s\n' "${SCRIPT_ID:-unknown}" "$cleanup_state" >&2
  trap - INT TERM
  kill -"$sig" "$$"
}

nested_cmd_run() {
  local workdir="$1"
  shift
  local cmd="${1:?usage: poc3-command.sh nested WORKDIR <command> [args...]}"
  shift
  local tool
  for tool in node busctl jq grep; do
    command -v "$tool" >/dev/null 2>&1 || {
      echo "error: required tool '$tool' not found in PATH" >&2
      exit 1
    }
  done
  nested_require_enabled
  if [[ "$cmd" == persistent-cleanup ]]; then
    nested_cmd_persistent_cleanup "$workdir" "$@"
    exit "$?"
  fi
  if [[ "$cmd" == start && ($# -eq 0 || "${1:-}" == --*) ]]; then
    nested_cmd_persistent_start "$workdir" "$@"
    exit "$?"
  fi
  if [[ "$cmd" == focus || "$cmd" == move || "$cmd" == stop ]] && [[ $# -eq 0 || "${1:-}" == --* ]]; then
    echo "error: persistent direct-enrollment supports initial start only (nested WORKDIR start with manifest evidence); '$cmd' needs the legacy route with three explicit window IDs" >&2
    exit 1
  fi
  [[ "$PLUGIN" == poc3-manual-command ]] || {
    echo "error: refusing to operate on unexpected plugin id '$PLUGIN'" >&2
    exit 1
  }
  [[ "$BUNDLE" == "$KWIN_DIR"/dist/poc3-manual-command.js ]] || {
    echo "error: refusing to build to an unexpected bundle path" >&2
    exit 1
  }
  [[ -f "$BUILD_HELPER" && ! -L "$BUILD_HELPER" ]] || {
    echo "error: command build helper is unavailable or symlinked: $BUILD_HELPER" >&2
    exit 1
  }
  trap 'nested_signal_during_command INT' INT
  trap 'nested_signal_during_command TERM' TERM
  nested_validate_manifest "$workdir" || exit 1
  nested_load_private_state "$workdir" || exit 1
  parse_command_args "$cmd" "$@"
  node "$BUILD_HELPER" "${HELPER_ARGS[@]}" --out "$BUNDLE" || {
    echo "error: command bundle build failed" >&2
    exit 1
  }
  [[ -f "$BUNDLE" && ! -L "$BUNDLE" ]] || {
    echo "error: command bundle was not created at the expected dist path" >&2
    exit 1
  }
  nested_validate_manifest "$workdir" || exit 1
  nested_load_private_state "$workdir" || exit 1
  nested_refuse_when_production_loaded
  if [[ "$(nested_loaded_word "$PLUGIN")" == loaded ]]; then
    echo "error: plugin '$PLUGIN' is already loaded; refusing to load again" >&2
    exit 1
  fi
  NESTED_KWIN_PID="$(nested_find_kwin_pid)" || {
    echo "error: could not identify one nested KWin process" >&2
    exit 1
  }
  KWIN_PID="$NESTED_KWIN_PID"
  local load_out script_obj introspect_out attempt done_marker log_start
  log_start="$(wc -l <"$NESTED_LOG_PATH" 2>/dev/null)" || {
    echo "error: nested private log is unreadable" >&2
    exit 1
  }
  [[ "$log_start" =~ ^[0-9]+$ ]] || {
    echo "error: nested private log size is invalid" >&2
    exit 1
  }
  load_out="$(busctl --address="$NESTED_BUS_ADDRESS" --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE loadScript ss "$BUNDLE" "$PLUGIN")" || {
    echo "error: loadScript call failed: $load_out" >&2
    exit 1
  }
  strict_json_matches "$load_valid" "$load_out" || {
    echo "error: unexpected loadScript reply: $load_out" >&2
    exit 1
  }
  SCRIPT_ID="$(jq -r '.data[0]' <<<"$load_out")"
  script_obj="/Scripting/Script$SCRIPT_ID"
  introspect_out="$(busctl --address="$NESTED_BUS_ADDRESS" --json=short introspect "$BUS_DEST" "$script_obj")" || {
    echo "error: introspect failed for $script_obj" >&2
    if nested_cleanup_loaded; then echo "command: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "command: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
    exit 1
  }
  strict_json_matches "$script_iface_valid" "$introspect_out" || {
    echo "error: $script_obj does not expose the org.kde.kwin.Script interface" >&2
    if nested_cleanup_loaded; then echo "command: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "command: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
    exit 1
  }
  if [[ "$(nested_loaded_word "$PLUGIN")" != loaded ]]; then
    echo "error: plugin '$PLUGIN' was not reported loaded after exact object introspection" >&2
    if nested_cleanup_loaded; then echo "command: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "command: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
    exit 1
  fi
  if ! busctl --address="$NESTED_BUS_ADDRESS" --json=short call "$BUS_DEST" "$script_obj" $BUS_SCRIPT_IFACE run >/dev/null 2>&1; then
    echo "error: run() failed on $script_obj" >&2
    if nested_cleanup_loaded; then echo "command: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "command: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
    exit 1
  fi
  done_marker="poc3-command-done:$DONE_TOKEN"
  for ((attempt = 0; attempt < READINESS_ATTEMPTS; attempt += 1)); do
    if tail -n +"$((log_start + 1))" -- "$NESTED_LOG_PATH" 2>/dev/null | grep -F -m 1 -- "$done_marker" >/dev/null 2>&1; then
      trap - INT TERM
      local detail
      detail="$(tail -n +"$((log_start + 1))" -- "$NESTED_LOG_PATH" 2>/dev/null | grep -F -- "$done_marker" | tail -n 1)"
      if nested_cleanup_loaded; then
        printf 'command: done pid=%s script-id=%s plugin=%s nonce=%s outcome=%s\n' "$KWIN_PID" "$SCRIPT_ID" "$PLUGIN" "$DONE_TOKEN" "$detail"
        exit 0
      else
        echo "command: done but exact unload was not verified" >&2
        exit 1
      fi
    fi
    sleep "$READINESS_DELAY"
  done
  echo "error: command completion diagnostic was not confirmed in the nested private log" >&2
  if nested_cleanup_loaded; then echo "command: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "command: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
  exit 1
}
# NESTED-ONLY ROUTE END

# PERSISTENT-ENROLL ROUTE BEGIN
# Persistent test-only direct-enrollment initial start (nested-only, initial
# start only). Disabled by default with the same POC3_NESTED_ALLOW=1 gate as
# the legacy nested route. Unlike the legacy one-shot route this path takes
# no window IDs and runs no ID probe: it validates WORKDIR/manifest plus the
# manifest private bus address/file and private log, binds exactly three
# manifest-recorded manual PIDs (manual_count==3, distinct positive PIDs, no
# disposable client_* mix) with live /proc start-tick/exe identity, embeds
# that PID evidence at build time into the generated persistent adapter
# bundle (fixed plugin poc3-persistent-adapter, fixed dist path), captures
# the loadScript ID immediately (including 0), retains the exact plugin/id
# in the manifest for persistent-cleanup, runs the bundle, and then
# establishes status ONLY from the D-Bus run reply plus the service-backed
# typed EvaluatePoc3 status acknowledgement plus independent
# post-observation. KWin print/log markers are never success authority here
# (they are not even read for success). The adapter stays loaded by design:
# success, divergence, and timeout all leave it loaded; only
# persistent-cleanup unloads the exact manifest-recorded identity. Focus,
# move, and stop have no direct-enrollment form on this route (initial start
# only); they remain available via the legacy three-ID route above.
PERSISTENT_PLUGIN="poc3-persistent-adapter"
PERSISTENT_BUNDLE="$KWIN_DIR/dist/poc3-persistent-adapter.js"
PERSISTENT_BUILD_HELPER="$REPO_ROOT/scripts/poc3-build-persistent-adapter.mjs"
PERSISTENT_PLANNER_SERVICE="org.plasmaautotiler.Planner"
PERSISTENT_PLANNER_OBJECT="/org/plasmaautotiler/Planner"
PERSISTENT_PLANNER_IFACE="org.plasmaautotiler.Planner1"
PERSISTENT_PLANNER_METHOD="EvaluatePoc3"
PERSISTENT_STATUS_ATTEMPTS=150
PERSISTENT_STATUS_DELAY=0.1
PERSISTENT_DIAG_BIN="poc3-diagnostic-client"
: "${NESTED_MANUAL_CLIENTS_SH:=$REPO_ROOT/scripts/nested-manual-clients.sh}"
PERS_OWNER=""
PERS_GENERATION=""
PERS_NONCE=""
PERS_GAP="8"
PERS_USABLE=""
PLANNER_UNIQUE=""
PERS_PIDS=""
PERS_TICKS=""
PERS_APP_IDS=""
PERS_SLOTS=""
PERS_COLORS=""

persistent_parse_start_args() {
  PERS_OWNER=""; PERS_GENERATION=""; PERS_NONCE=""; PERS_GAP="8"; PERS_USABLE=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --owner) valid_owner "${2:-}" || { echo "error: invalid --owner" >&2; exit 1; }; PERS_OWNER="$2"; shift 2 ;;
      --generation) valid_token "${2:-}" || { echo "error: invalid --generation" >&2; exit 1; }; PERS_GENERATION="$2"; shift 2 ;;
      --nonce) valid_token "${2:-}" || { echo "error: invalid --nonce" >&2; exit 1; }; PERS_NONCE="$2"; shift 2 ;;
      --gap) valid_gap "${2:-}" || { echo "error: invalid --gap" >&2; exit 1; }; PERS_GAP="$2"; shift 2 ;;
      --usable) echo "error: enroll-start derives usable area from the observed native output; --usable is rejected on the direct route" >&2; exit 1 ;;
      --*) echo "error: unknown enroll-start flag '$1' (persistent direct-enrollment supports only --owner/--generation/--nonce/--gap; initial start only)" >&2; exit 1 ;;
      *) echo "error: enroll-start takes no window IDs; supply manifest WORKDIR evidence only (no probe, no caller IDs)" >&2; exit 1 ;;
    esac
  done
  [[ -n "$PERS_OWNER" ]] || { echo "error: enroll-start requires --owner" >&2; exit 1; }
  [[ -n "$PERS_GENERATION" ]] || { echo "error: enroll-start requires --generation" >&2; exit 1; }
  [[ -n "$PERS_NONCE" ]] || { echo "error: enroll-start requires --nonce" >&2; exit 1; }
}

persistent_load_manual_pids() {
  local manifest="$1" count p1 p2 p3
  [[ -n "$manifest" ]] || return 1
  [[ -f "$manifest" && ! -L "$manifest" ]] || { echo "error: nested manifest file is absent or symlinked" >&2; return 1; }
  if grep -q -e '^client_' -- "$manifest"; then
    echo "error: disposable client_* group is recorded; enroll-start refuses to mix modes" >&2
    return 1
  fi
  count="$(nested_manifest_get "$manifest" manual_count)" || { echo "error: manual group is not ready (missing manual_count)" >&2; return 1; }
  [[ "$count" == 3 ]] || { echo "error: manual_count must be exactly 3 for enroll-start eligibility (found $count)" >&2; return 1; }
  p1="$(nested_manifest_get "$manifest" manual_1_pid)" || { echo "error: manual group is not ready (slot 1 missing)" >&2; return 1; }
  p2="$(nested_manifest_get "$manifest" manual_2_pid)" || { echo "error: manual group is not ready (slot 2 missing)" >&2; return 1; }
  p3="$(nested_manifest_get "$manifest" manual_3_pid)" || { echo "error: manual group is not ready (slot 3 missing)" >&2; return 1; }
  [[ "$p1" =~ ^[1-9][0-9]*$ && "$p2" =~ ^[1-9][0-9]*$ && "$p3" =~ ^[1-9][0-9]*$ ]] || { echo "error: manual PIDs must be positive integers" >&2; return 1; }
  [[ "$p1" != "$p2" && "$p1" != "$p3" && "$p2" != "$p3" ]] || { echo "error: recorded manual PIDs are not distinct (shared PID)" >&2; return 1; }
  [[ "$p1" -le 4294967295 && "$p2" -le 4294967295 && "$p3" -le 4294967295 ]] || { echo "error: manual PIDs out of range" >&2; return 1; }
  printf '%s,%s,%s' "$p1" "$p2" "$p3"
}

persistent_proc_tick() {
  local pid="$1" stat_line rest
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  stat_line="$(cat -- "${PROC_ROOT:-/proc}/$pid/stat" 2>/dev/null)" || return 1
  [[ "$stat_line" != *$'\n'* ]] || return 1
  [[ "${stat_line%% *}" == "$pid" ]] || return 1
  rest="${stat_line##*) }"
  [[ "$rest" != "$stat_line" ]] || return 1
  local IFS=$' \t\n'
  local -a fields=()
  read -r -a fields <<<"$rest" || return 1
  [[ "${#fields[@]}" -ge 20 && "${fields[0]:-}" =~ ^[A-Za-z]$ ]] || return 1
  [[ "${fields[19]:-}" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s' "${fields[19]}"
}

persistent_check_ticks() {
  local manifest="$1" pids="$2" i pid tick exe live_tick live_exe
  local IFS=','
  local -a parts=()
  read -r -a parts <<<"$pids" || return 1
  [[ "${#parts[@]}" -eq 3 ]] || return 1
  for i in 1 2 3; do
    pid="${parts[$((i - 1))]}"
    tick="$(nested_manifest_get "$manifest" "manual_${i}_starttick")" || { echo "error: manifest is missing manual_${i}_starttick (tick mismatch suspected)" >&2; return 1; }
    exe="$(nested_manifest_get "$manifest" "manual_${i}_exe")" || { echo "error: manifest is missing manual_${i}_exe" >&2; return 1; }
    [[ "$tick" =~ ^[1-9][0-9]*$ ]] || { echo "error: manual_${i} starttick is not a positive integer" >&2; return 1; }
    live_tick="$(persistent_proc_tick "$pid")" || { echo "error: manual pid $pid is stale or unreadable (PID reuse suspected)" >&2; return 1; }
    [[ "$live_tick" == "$tick" ]] || { echo "error: manual_${i} start-tick mismatch (PID reuse suspected)" >&2; return 1; }
    live_exe="$(readlink -- "${PROC_ROOT:-/proc}/$pid/exe" 2>/dev/null)" || { echo "error: manual_${i} executable identity is unreadable" >&2; return 1; }
    [[ -n "$live_exe" && "$live_exe" == /* && "$live_exe" != *' (deleted)'* ]] || { echo "error: manual_${i} executable identity is unreadable" >&2; return 1; }
    [[ "$live_exe" == "$exe" ]] || { echo "error: manual_${i} executable mismatch" >&2; return 1; }
  done
}

persistent_load_manual_ticks() {
  local manifest="$1" t1 t2 t3
  [[ -n "$manifest" ]] || return 1
  t1="$(nested_manifest_get "$manifest" manual_1_starttick)" || { echo "error: manual group is not ready (slot 1 tick missing)" >&2; return 1; }
  t2="$(nested_manifest_get "$manifest" manual_2_starttick)" || { echo "error: manual group is not ready (slot 2 tick missing)" >&2; return 1; }
  t3="$(nested_manifest_get "$manifest" manual_3_starttick)" || { echo "error: manual group is not ready (slot 3 tick missing)" >&2; return 1; }
  [[ "$t1" =~ ^[1-9][0-9]*$ && "$t2" =~ ^[1-9][0-9]*$ && "$t3" =~ ^[1-9][0-9]*$ ]] || { echo "error: manual start-ticks must be positive integers" >&2; return 1; }
  [[ "$t1" != "$t2" && "$t1" != "$t3" && "$t2" != "$t3" ]] || { echo "error: recorded manual start-ticks are not distinct (shared evidence)" >&2; return 1; }
  printf '%s,%s,%s' "$t1" "$t2" "$t3"
}

persistent_validate_slot_evidence() {
  local manifest="$1" i bin canon
  for i in 1 2 3; do
    bin="$(nested_manifest_get "$manifest" "manual_${i}_bin")" || { echo "error: trio slot $i app identity is not recorded; refusing ambiguous enroll" >&2; return 1; }
    canon="$(nested_manifest_get "$manifest" "manual_${i}_bin_canonical")" || { echo "error: trio slot $i app identity is not recorded; refusing ambiguous enroll" >&2; return 1; }
    [[ "${bin##*/}" == "$PERSISTENT_DIAG_BIN" ]] || { echo "error: trio slot $i is not the manifest-bound diagnostic client (found ${bin##*/}); refusing non-diagnostic enroll" >&2; return 1; }
    [[ "${canon##*/}" == "$PERSISTENT_DIAG_BIN" ]] || { echo "error: trio slot $i canonical is not the manifest-bound diagnostic client; refusing non-diagnostic enroll" >&2; return 1; }
    nested_manifest_get "$manifest" "manual_${i}_diag_path" >/dev/null || { echo "error: trio slot $i diagnostic capture is not recorded; refusing ambiguous enroll" >&2; return 1; }
  done
}

persistent_lock_acquire() {
  local workdir="$1" lockdir="$workdir/.manifest.lock" attempts=0
  while ! mkdir -- "$lockdir" 2>/dev/null; do
    attempts=$((attempts + 1))
    if [[ "$attempts" -ge 200 ]]; then
      echo "error: manifest lock is held for '$workdir'; refusing concurrent mutation (no lost update)" >&2
      return 1
    fi
    sleep 0.05 || return 1
  done
}

persistent_lock_release() {
  rmdir -- "$1/.manifest.lock" 2>/dev/null || true
}

persistent_record_success() {
  local manifest="$1" plugin="$2" script_id="$3" owner="$4" generation="$5" nonce="$6" pids="$7" workdir tmp
  workdir="$(dirname -- "$manifest")" || { echo "error: could not derive the enroll workdir" >&2; return 1; }
  [[ "$plugin" == "$PERSISTENT_PLUGIN" ]] || { echo "error: refusing to record unexpected plugin id '$plugin'" >&2; return 1; }
  [[ "$script_id" =~ ^[0-9]+$ && "$script_id" -le 2147483647 ]] || { echo "error: refusing to record invalid script id" >&2; return 1; }
  valid_owner "$owner" || { echo "error: refusing to record invalid enroll owner" >&2; return 1; }
  valid_token "$generation" || { echo "error: refusing to record invalid enroll generation" >&2; return 1; }
  valid_token "$nonce" || { echo "error: refusing to record invalid enroll nonce" >&2; return 1; }
  [[ "$pids" =~ ^[1-9][0-9]*,[1-9][0-9]*,[1-9][0-9]*$ ]] || { echo "error: refusing to record invalid enroll pids" >&2; return 1; }
  persistent_lock_acquire "$workdir" || return 1
  if grep -q -e '^persistent_' -- "$manifest"; then
    persistent_lock_release "$workdir"
    echo "error: persistent enroll identity is already recorded; use persistent-cleanup WORKDIR first" >&2
    return 1
  fi
  tmp="$(mktemp "$workdir/.manifest.XXXXXX")" || { persistent_lock_release "$workdir"; echo "error: could not stage the enroll manifest" >&2; return 1; }
  cp -p -- "$manifest" "$tmp" || { persistent_lock_release "$workdir"; rm -f -- "$tmp"; echo "error: could not stage the enroll manifest" >&2; return 1; }
  {
    printf 'persistent_plugin=%s\n' "$plugin"
    printf 'persistent_script_id=%s\n' "$script_id"
    printf 'persistent_owner=%s\n' "$owner"
    printf 'persistent_generation=%s\n' "$generation"
    printf 'persistent_nonce=%s\n' "$nonce"
    printf 'persistent_pids=%s\n' "$pids"
  } >> "$tmp" || { persistent_lock_release "$workdir"; rm -f -- "$tmp"; echo "error: could not record enroll identity" >&2; return 1; }
  mv -f -- "$tmp" "$manifest" || { persistent_lock_release "$workdir"; rm -f -- "$tmp"; echo "error: could not finalize the enroll manifest" >&2; return 1; }
  persistent_lock_release "$workdir"
}

persistent_clear_record() {
  local manifest="$1" workdir tmp
  workdir="$(dirname -- "$manifest")" || { echo "error: could not derive the enroll workdir" >&2; return 1; }
  persistent_lock_acquire "$workdir" || return 1
  tmp="$(mktemp "$workdir/.manifest.XXXXXX")" || { persistent_lock_release "$workdir"; echo "error: could not stage the enroll manifest" >&2; return 1; }
  grep -v -e '^persistent_' -- "$manifest" > "$tmp" || true
  [[ -s "$tmp" ]] || { persistent_lock_release "$workdir"; rm -f -- "$tmp"; echo "error: enroll record removal would empty the manifest" >&2; return 1; }
  mv -f -- "$tmp" "$manifest" || { persistent_lock_release "$workdir"; rm -f -- "$tmp"; echo "error: could not finalize the enroll manifest" >&2; return 1; }
  persistent_lock_release "$workdir"
}

# Exact pre-mutation binding for the manifest-bound diagnostic trio (no
# mutation here): rejects disposable client_* mixes, requires exactly three
# manual slots with live PID/start-tick/exe identity plus per-slot
# diagnostic app-id (exact poc3-diagnostic-client bin/canonical, exe bound to
# canonical) and slot capture shape (bounded workdir-local direct-child diag
# path, distinct PIDs and diag paths). Full canonical/hash/device/inode plus
# argv binding is revalidated by the delegated manual-client cleanup; this
# gate keeps persistent-cleanup from closing non-diagnostic clients.
persistent_validate_trio_binding() {
  local manifest="$1" workdir="$2" i pid tick exe bin canon argc argv_sha diag seen="" dseen=" "
  if grep -q -e '^client_' -- "$manifest"; then
    echo "error: disposable client_* group is recorded; persistent-cleanup closes only the manifest-bound diagnostic trio" >&2
    return 1
  fi
  local count
  count="$(nested_manifest_get "$manifest" manual_count)" || { echo "error: manual diagnostic trio is not recorded (missing manual_count); refusing unrecorded trio close" >&2; return 1; }
  [[ "$count" == 3 ]] || { echo "error: manual_count must be exactly 3 for trio close (found $count)" >&2; return 1; }
  for i in 1 2 3; do
    pid="$(nested_manifest_get "$manifest" "manual_${i}_pid")" || { echo "error: trio slot $i pid is not recorded; refusing ambiguous trio close" >&2; return 1; }
    tick="$(nested_manifest_get "$manifest" "manual_${i}_starttick")" || { echo "error: trio slot $i starttick is not recorded; refusing ambiguous trio close" >&2; return 1; }
    exe="$(nested_manifest_get "$manifest" "manual_${i}_exe")" || { echo "error: trio slot $i exe is not recorded; refusing ambiguous trio close" >&2; return 1; }
    bin="$(nested_manifest_get "$manifest" "manual_${i}_bin")" || { echo "error: trio slot $i app identity is not recorded; refusing ambiguous trio close" >&2; return 1; }
    canon="$(nested_manifest_get "$manifest" "manual_${i}_bin_canonical")" || { echo "error: trio slot $i app identity is not recorded; refusing ambiguous trio close" >&2; return 1; }
    argc="$(nested_manifest_get "$manifest" "manual_${i}_argc")" || { echo "error: trio slot $i argv identity is not recorded; refusing ambiguous trio close" >&2; return 1; }
    argv_sha="$(nested_manifest_get "$manifest" "manual_${i}_argv_sha256")" || { echo "error: trio slot $i argv identity is not recorded; refusing ambiguous trio close" >&2; return 1; }
    diag="$(nested_manifest_get "$manifest" "manual_${i}_diag_path")" || { echo "error: trio slot $i diagnostic capture is not recorded; refusing ambiguous trio close" >&2; return 1; }
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] || { echo "error: trio slot $i pid is not a positive integer" >&2; return 1; }
    [[ "$tick" =~ ^[1-9][0-9]*$ ]] || { echo "error: trio slot $i starttick is not a positive integer" >&2; return 1; }
    [[ "${bin##*/}" == "$PERSISTENT_DIAG_BIN" ]] || { echo "error: trio slot $i is not the manifest-bound diagnostic client (found ${bin##*/}); refusing non-diagnostic close" >&2; return 1; }
    [[ "${canon##*/}" == "$PERSISTENT_DIAG_BIN" ]] || { echo "error: trio slot $i canonical is not the manifest-bound diagnostic client; refusing non-diagnostic close" >&2; return 1; }
    [[ "$exe" == "$canon" ]] || { echo "error: trio slot $i executable mismatch (expected canonical identity)" >&2; return 1; }
    [[ "$argc" =~ ^[1-9][0-9]*$ ]] || { echo "error: trio slot $i argc is not a positive integer" >&2; return 1; }
    [[ "$argv_sha" =~ ^[0-9a-fA-F]{64}$ ]] || { echo "error: trio slot $i argv sha256 is malformed" >&2; return 1; }
    nested_safe_abs "$diag" || { echo "error: trio slot $i diag path is unsafe" >&2; return 1; }
    [[ "$diag" == "$workdir"/* ]] || { echo "error: trio slot $i diag path escapes the WORKDIR" >&2; return 1; }
    [[ "${diag%/*}" == "$workdir" ]] || { echo "error: trio slot $i diag path must be a direct child of the WORKDIR (bounded)" >&2; return 1; }
    case "$dseen" in *" $diag "*) { echo "error: recorded trio diagnostic paths are not distinct (duplicate capture)" >&2; return 1; } ;; esac
    dseen+=" $diag "
    case "$seen" in *" $pid "*) { echo "error: recorded trio PIDs are not distinct (duplicate $pid)" >&2; return 1; } ;; esac
    seen+=" $pid "
  done
  local sup_pid
  if grep -q -e '^diag_supervisor_pid=' -- "$manifest"; then
    sup_pid="$(nested_manifest_get "$manifest" diag_supervisor_pid)" || { echo "error: supervisor pid is not recorded; refusing ambiguous trio close" >&2; return 1; }
    case "$seen" in *" $sup_pid "*) { echo "error: supervisor PID collides with trio PID $sup_pid; refusing ambiguous trio close" >&2; return 1; } ;; esac
  fi
  persistent_check_ticks "$manifest" "$(persistent_load_manual_pids "$manifest")" || return 1
}

persistent_exact_unload() {
  # Exact recorded-identity unload only. KWin exposes no plugin identity on
  # /Scripting/ScriptN, so this retains the exact plugin plus returned ID,
  # introspects that exact ID for the Script interface, verifies the plugin
  # loaded word, stops that exact object, unloads that exact plugin, and
  # verifies not-loaded. No stronger claim is made.
  local id="$1" out after introspect_out
  [[ "$id" =~ ^[0-9]+$ && "$id" -le 2147483647 ]] || return 1
  introspect_out="$(busctl --address="$NESTED_BUS_ADDRESS" --json=short introspect "$BUS_DEST" "/Scripting/Script$id" 2>/dev/null)" || return 1
  strict_json_matches "$script_iface_valid" "$introspect_out" || return 1
  [[ "$(nested_loaded_word "$PERSISTENT_PLUGIN")" == loaded ]] || return 1
  busctl --address="$NESTED_BUS_ADDRESS" call "$BUS_DEST" "/Scripting/Script$id" $BUS_SCRIPT_IFACE stop >/dev/null 2>&1 || true
  out="$(busctl --address="$NESTED_BUS_ADDRESS" --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE unloadScript s "$PERSISTENT_PLUGIN" 2>/dev/null)" || return 1
  strict_json_matches "$unload_valid" "$out" || return 1
  [[ "$(jq -r '.data[0]' <<<"$out")" == true ]] || return 1
  after="$(nested_loaded_word "$PERSISTENT_PLUGIN")" || return 1
  [[ "$after" == not-loaded ]] || return 1
}

persistent_signal_during_enroll() {
  local sig="$1"
  printf 'enroll-start: partial script-id=%s plugin=%s stays-loaded (use persistent-cleanup WORKDIR)\n' "${SCRIPT_ID:-unknown}" "$PERSISTENT_PLUGIN" >&2
  trap - INT TERM
  kill -"$sig" "$$"
}

# Exact planner D-Bus unique owner on the private bus. Resolved immediately
# before build/load; replacement or loss rejects with no well-known fallback.
# This is the D-Bus unique name (`:N.M`), never the session owner token.
persistent_planner_unique_owner() {
  local owner_out owner
  owner_out="$(busctl --address="$NESTED_BUS_ADDRESS" --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s "$PERSISTENT_PLANNER_SERVICE" 2>/dev/null)" || {
    echo "error: planner service has no current unique owner on the private bus (service loss suspected)" >&2
    return 1
  }
  strict_json_matches "$dbus_string_valid" "$owner_out" || {
    echo "error: planner unique-owner reply is malformed" >&2
    return 1
  }
  owner="$(jq -r '.data[0]' <<<"$owner_out")"
  [[ "$owner" =~ ^:[0-9]+\.[0-9]+$ ]] || {
    echo "error: planner unique owner is malformed" >&2
    return 1
  }
  printf '%s' "$owner"
}

persistent_planner_status_inner() {
  local unique_owner="$1" correlation="$2" req out inner
  [[ "$unique_owner" =~ ^:[0-9]+\.[0-9]+$ ]] || return 1
  req="$(jq -n --arg c "$correlation" '{v:3,command:"status",correlation_id:$c}')" || return 1
  out="$(busctl --address="$NESTED_BUS_ADDRESS" --json=short call "$unique_owner" "$PERSISTENT_PLANNER_OBJECT" $PERSISTENT_PLANNER_IFACE $PERSISTENT_PLANNER_METHOD s "$req" 2>/dev/null)" || return 1
  strict_json_matches "$dbus_string_valid" "$out" || return 1
  inner="$(jq -r '.data[0]' <<<"$out")"
  [[ -n "$inner" && "${#inner}" -le 65536 ]] || return 1
  jq -e . >/dev/null 2>&1 <<<"$inner" || return 1
  printf '%s' "$inner"
}

persistent_status_is_disabled() {
  local inner="$1" correlation="$2"
  jq -e --arg c "$correlation" '.v == 3 and .command == "status" and .correlation_id == $c and .outcome == "ok" and .status.state == "disabled" and .status.revision == 0 and .status.pending == false and .status.divergent == false' <<<"$inner" >/dev/null 2>&1
}

persistent_status_is_applied() {
  local inner="$1" correlation="$2"
  jq -e --arg c "$correlation" '.v == 3 and .command == "status" and .correlation_id == $c and .outcome == "ok" and .status.state == "active" and .status.revision == 1 and .status.pending == false and .status.divergent == false and (.status.enrolled | type == "array" and length == 3) and (.status.topology | type == "string" and test("^H\\[[^,\\[\\]]+,V\\[[^,\\[\\]]+,[^,\\[\\]]+\\]\\]$")) and (.status.focus | type == "string") and (.status.focus as $f | .status.enrolled | index($f) != null)' <<<"$inner" >/dev/null 2>&1
}

persistent_status_is_divergent() {
  local inner="$1"
  jq -e '.status.state == "divergent" or .status.divergent == true or .outcome == "diverged"' <<<"$inner" >/dev/null 2>&1
}

persistent_status_summary() {
  local inner="$1"
  jq -r '[.status.revision, .status.topology, .status.focus] | map(tostring) | join(" ")' <<<"$inner" 2>/dev/null
}

nested_cmd_persistent_start() {
  local workdir="$1"
  shift
  local tool
  for tool in node busctl jq grep mktemp cp mv rm mkdir rmdir stat readlink sleep; do
    command -v "$tool" >/dev/null 2>&1 || {
      echo "error: required tool '$tool' not found in PATH" >&2
      exit 1
    }
  done
  nested_require_enabled
  [[ "$PERSISTENT_PLUGIN" == poc3-persistent-adapter ]] || {
    echo "error: refusing to operate on unexpected plugin id '$PERSISTENT_PLUGIN'" >&2
    exit 1
  }
  [[ "$PERSISTENT_BUNDLE" == "$KWIN_DIR"/dist/poc3-persistent-adapter.js ]] || {
    echo "error: refusing to build to an unexpected bundle path" >&2
    exit 1
  }
  [[ -f "$PERSISTENT_BUILD_HELPER" && ! -L "$PERSISTENT_BUILD_HELPER" ]] || {
    echo "error: persistent build helper is unavailable or symlinked: $PERSISTENT_BUILD_HELPER" >&2
    exit 1
  }
  trap 'persistent_signal_during_enroll INT' INT
  trap 'persistent_signal_during_enroll TERM' TERM
  nested_validate_manifest "$workdir" || exit 1
  nested_load_private_state "$workdir" || exit 1
  persistent_parse_start_args "$@"
  nested_validate_manifest "$workdir" || exit 1
  nested_load_private_state "$workdir" || exit 1
  PERS_PIDS="$(persistent_load_manual_pids "$NESTED_WORKDIR/manifest")" || exit 1
  [[ "$PERS_PIDS" =~ ^[1-9][0-9]*,[1-9][0-9]*,[1-9][0-9]*$ ]] || { echo "error: manual PIDs failed validation" >&2; exit 1; }
  persistent_check_ticks "$NESTED_WORKDIR/manifest" "$PERS_PIDS" || exit 1
  # Full per-slot manifest evidence plus private planner expectations, all
  # validated before the bundle build and again before any planner call or
  # native write below. PIDs alone are never sufficient.
  PERS_TICKS="$(persistent_load_manual_ticks "$NESTED_WORKDIR/manifest")" || exit 1
  PERS_APP_IDS="org.plasma-auto-tiler.poc3-diag-1,org.plasma-auto-tiler.poc3-diag-2,org.plasma-auto-tiler.poc3-diag-3"
  PERS_SLOTS="1,2,3"
  PERS_COLORS="ffc02020,ff20a020,ff2040c0"
  # Full trio identity gate (canonical/hash/dev/ino/argv/exe, distinct local
  # diag paths, exact PIDs/start ticks, app_id slot binding); basename-only
  # evidence is never sufficient. App_id/slot mismatch rejects pre-transport.
  persistent_validate_trio_binding "$NESTED_WORKDIR/manifest" "$NESTED_WORKDIR" || exit 1
  [[ -n "$NESTED_BUS_ADDRESS" ]] || { echo "error: nested private bus address is empty" >&2; exit 1; }
  if grep -q -e '^persistent_' -- "$NESTED_WORKDIR/manifest"; then
    echo "error: persistent enroll identity is already recorded for this WORKDIR; use persistent-cleanup WORKDIR first" >&2
    exit 1
  fi
  # Exact planner unique owner on the private bus, resolved immediately before
  # build. This is the D-Bus unique name (`:N.M`), distinct from the session
  # owner token (--planner-owner). Replacement/loss rejects; no fallback.
  local planner_unique_build
  planner_unique_build="$(persistent_planner_unique_owner)" || exit 1
  local build_args=(--owner "$PERS_OWNER" --generation "$PERS_GENERATION" --nonce "$PERS_NONCE" --expected-pids "$PERS_PIDS" --expected-ticks "$PERS_TICKS" --expected-app-ids "$PERS_APP_IDS" --expected-slots "$PERS_SLOTS" --expected-colors "$PERS_COLORS" --planner-owner "$PERS_OWNER" --planner-unique-owner "$planner_unique_build" --planner-bus "$NESTED_BUS_ADDRESS" --gap "$PERS_GAP")
  node "$PERSISTENT_BUILD_HELPER" "${build_args[@]}" --out "$PERSISTENT_BUNDLE" || {
    echo "error: persistent bundle build failed" >&2
    exit 1
  }
  [[ -f "$PERSISTENT_BUNDLE" && ! -L "$PERSISTENT_BUNDLE" ]] || {
    echo "error: persistent bundle was not created at the expected dist path" >&2
    exit 1
  }
  nested_validate_manifest "$workdir" || exit 1
  nested_load_private_state "$workdir" || exit 1
  local pids_verify ticks_verify
  pids_verify="$(persistent_load_manual_pids "$NESTED_WORKDIR/manifest")" || exit 1
  [[ "$pids_verify" == "$PERS_PIDS" ]] || { echo "error: manual PIDs changed between build and transport; refusing stale bundle" >&2; exit 1; }
  ticks_verify="$(persistent_load_manual_ticks "$NESTED_WORKDIR/manifest")" || exit 1
  [[ "$ticks_verify" == "$PERS_TICKS" ]] || { echo "error: manual start-ticks changed between build and transport; refusing stale bundle" >&2; exit 1; }
  persistent_check_ticks "$NESTED_WORKDIR/manifest" "$PERS_PIDS" || exit 1
  # Immediate pre-load/run full identity/tick/private-bus validation: the full
  # trio gate plus tick liveness plus fresh private state, then the planner
  # unique owner is re-resolved and must equal the build-time owner.
  persistent_validate_trio_binding "$NESTED_WORKDIR/manifest" "$NESTED_WORKDIR" || exit 1
  local planner_unique_load
  planner_unique_load="$(persistent_planner_unique_owner)" || exit 1
  [[ "$planner_unique_load" == "$planner_unique_build" ]] || { echo "error: planner unique owner changed between build and load (replacement suspected); refusing stale bundle" >&2; exit 1; }
  PLANNER_UNIQUE="$planner_unique_load"
  nested_refuse_when_production_loaded
  if [[ "$(nested_loaded_word "$PERSISTENT_PLUGIN")" == loaded ]]; then
    echo "error: plugin '$PERSISTENT_PLUGIN' is already loaded; refusing to load again" >&2
    exit 1
  fi
  NESTED_KWIN_PID="$(nested_find_kwin_pid)" || {
    echo "error: could not identify one nested KWin process" >&2
    exit 1
  }
  KWIN_PID="$NESTED_KWIN_PID"
  local pre_corr="pstatus-${PERS_NONCE:0:40}-pre" pre_inner
  pre_inner="$(persistent_planner_status_inner "$PLANNER_UNIQUE" "$pre_corr")" || {
    echo "error: planner service is unreachable before enroll (service loss suspected)" >&2
    exit 1
  }
  persistent_status_is_disabled "$pre_inner" "$pre_corr" || {
    echo "error: planner already holds a session; refusing stale enroll (expected disabled revision 0)" >&2
    exit 1
  }
  local load_out script_obj introspect_out
  load_out="$(busctl --address="$NESTED_BUS_ADDRESS" --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE loadScript ss "$PERSISTENT_BUNDLE" "$PERSISTENT_PLUGIN")" || {
    echo "error: loadScript call failed: $load_out" >&2
    exit 1
  }
  strict_json_matches "$load_valid" "$load_out" || {
    echo "error: unexpected loadScript reply: $load_out" >&2
    exit 1
  }
  SCRIPT_ID="$(jq -r '.data[0]' <<<"$load_out")"
  script_obj="/Scripting/Script$SCRIPT_ID"
  introspect_out="$(busctl --address="$NESTED_BUS_ADDRESS" --json=short introspect "$BUS_DEST" "$script_obj")" || {
    echo "error: introspect failed for $script_obj" >&2
    echo "enroll-start: partial script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2
    exit 1
  }
  strict_json_matches "$script_iface_valid" "$introspect_out" || {
    echo "error: $script_obj does not expose the org.kde.kwin.Script interface" >&2
    if persistent_exact_unload "$SCRIPT_ID"; then echo "enroll-start: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "enroll-start: partial script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2; fi
    exit 1
  }
  if [[ "$(nested_loaded_word "$PERSISTENT_PLUGIN")" != loaded ]]; then
    echo "error: plugin '$PERSISTENT_PLUGIN' was not reported loaded after exact object introspection" >&2
    if persistent_exact_unload "$SCRIPT_ID"; then echo "enroll-start: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "enroll-start: partial script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2; fi
    exit 1
  fi
  persistent_record_success "$NESTED_WORKDIR/manifest" "$PERSISTENT_PLUGIN" "$SCRIPT_ID" "$PERS_OWNER" "$PERS_GENERATION" "$PERS_NONCE" "$PERS_PIDS" || {
    persistent_exact_unload "$SCRIPT_ID" >/dev/null 2>&1 || true
    exit 1
  }
  nested_validate_manifest "$workdir" || {
    echo "error: manifest no longer validates after enroll record; residue stays loaded" >&2
    echo "enroll-start: partial script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2
    exit 1
  }
  nested_load_private_state "$workdir" || {
    echo "error: private state no longer validates after enroll record; residue stays loaded" >&2
    echo "enroll-start: partial script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2
    exit 1
  }
  local kwin_recheck
  kwin_recheck="$(nested_find_kwin_pid)" || {
    echo "error: nested KWin ownership was lost after enroll record; residue stays loaded" >&2
    echo "enroll-start: partial script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2
    exit 1
  }
  [[ "$kwin_recheck" == "$KWIN_PID" ]] || {
    echo "error: nested KWin PID changed after enroll record (ownership loss); residue stays loaded" >&2
    echo "enroll-start: partial script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2
    exit 1
  }
  # Captured (never discarded) run reply: success authority needs this plus
  # the exact-unique-owner typed status below plus adapter-side observation.
  local run_out
  if ! run_out="$(busctl --address="$NESTED_BUS_ADDRESS" --json=short call "$BUS_DEST" "$script_obj" $BUS_SCRIPT_IFACE run 2>&1)"; then
    echo "error: run() failed on $script_obj: $run_out" >&2
    echo "enroll-start: partial script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2
    exit 1
  fi
  # `run` returns void: any non-empty JSON error payload rejects.
  if [[ -n "$run_out" ]] && ! jq -e . >/dev/null 2>&1 <<<"$run_out"; then
    echo "error: run() reply on $script_obj is malformed" >&2
    echo "enroll-start: partial script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2
    exit 1
  fi
  local attempt=0 seq=0 inner corr summary
  for ((attempt = 0; attempt < PERSISTENT_STATUS_ATTEMPTS; attempt += 1)); do
    seq=$((attempt + 1))
    corr="pstatus-${PERS_NONCE:0:40}-$seq"
    inner="$(persistent_planner_status_inner "$PLANNER_UNIQUE" "$corr" 2>/dev/null)" || { sleep "$PERSISTENT_STATUS_DELAY"; continue; }
    if persistent_status_is_applied "$inner" "$corr"; then
      summary="$(persistent_status_summary "$inner")"
      nested_validate_manifest "$workdir" >/dev/null 2>&1 || {
        echo "error: manifest no longer validates in post-observation; residue stays loaded" >&2
        echo "enroll-start: partial script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2
        exit 1
      }
      nested_load_private_state "$workdir" >/dev/null 2>&1 || {
        echo "error: private state no longer validates in post-observation; residue stays loaded" >&2
        echo "enroll-start: partial script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2
        exit 1
      }
      kwin_recheck="$(nested_find_kwin_pid 2>/dev/null)" || {
        echo "error: nested KWin ownership was lost in post-observation; residue stays loaded" >&2
        echo "enroll-start: partial script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2
        exit 1
      }
      [[ "$kwin_recheck" == "$KWIN_PID" ]] || {
        echo "error: nested KWin PID changed in post-observation (ownership loss); residue stays loaded" >&2
        echo "enroll-start: partial script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2
        exit 1
      }
      persistent_check_ticks "$NESTED_WORKDIR/manifest" "$PERS_PIDS" >/dev/null 2>&1 || {
        echo "error: manual identities changed in post-observation; residue stays loaded" >&2
        echo "enroll-start: partial script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2
        exit 1
      }
      # Planner endpoint must still be the exact bound unique owner; any
      # replacement/loss fails closed even after an applied read.
      local planner_recheck
      planner_recheck="$(persistent_planner_unique_owner 2>/dev/null)" || {
        echo "error: planner unique owner was lost in post-observation; residue stays loaded" >&2
        echo "enroll-start: partial script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2
        exit 1
      }
      [[ "$planner_recheck" == "$PLANNER_UNIQUE" ]] || {
        echo "error: planner unique owner changed in post-observation (replacement suspected); residue stays loaded" >&2
        echo "enroll-start: partial script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2
        exit 1
      }
      local confirm_corr="pstatus-${PERS_NONCE:0:40}-confirm" confirm
      confirm="$(persistent_planner_status_inner "$PLANNER_UNIQUE" "$confirm_corr" 2>/dev/null)" || {
        echo "error: planner service was lost in post-observation; residue stays loaded" >&2
        echo "enroll-start: partial script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2
        exit 1
      }
      persistent_status_is_applied "$confirm" "$confirm_corr" || {
        echo "error: typed status did not stay applied in post-observation; residue stays loaded" >&2
        echo "enroll-start: partial script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2
        exit 1
      }
      trap - INT TERM
      printf 'enroll-start: done pid=%s script-id=%s plugin=%s nonce=%s status=%s\n' "$KWIN_PID" "$SCRIPT_ID" "$PERSISTENT_PLUGIN" "$PERS_NONCE" "$summary"
      exit 0
    fi
    if persistent_status_is_divergent "$inner"; then
      trap - INT TERM
      echo "error: planner recorded divergence (fail-closed partial apply); residue stays loaded" >&2
      echo "enroll-start: divergent script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2
      exit 1
    fi
    sleep "$PERSISTENT_STATUS_DELAY"
  done
  echo "error: typed enroll acknowledgement was not confirmed (expected active revision 1, log markers are never authority)" >&2
  echo "enroll-start: partial script-id=$SCRIPT_ID plugin=$PERSISTENT_PLUGIN stays-loaded (use persistent-cleanup WORKDIR)" >&2
  exit 1
}

# Persistent unload state is retained in the manifest until the
# manifest-bound trio close verifies: after a verified unload the record
# keeps `persistent_unload_verified=1` so a retry never calls unload again
# when the adapter is already verified unloaded. The KWin Scripting API
# exposes no plugin identity on /Scripting/ScriptN, so cleanup binds only the
# exact retained plugin plus returned ID plus exact-ID introspection plus the
# loaded check; no stronger plugin-to-script claim is made.
persistent_mark_unload_verified() {
  local manifest="$1" workdir tmp
  workdir="$(dirname -- "$manifest")" || return 1
  grep -q -e '^persistent_unload_verified=1$' -- "$manifest" 2>/dev/null && return 0
  persistent_lock_acquire "$workdir" || return 1
  tmp="$(mktemp "$workdir/.manifest.XXXXXX")" || { persistent_lock_release "$workdir"; return 1; }
  cp -p -- "$manifest" "$tmp" || { persistent_lock_release "$workdir"; rm -f -- "$tmp"; return 1; }
  printf 'persistent_unload_verified=1\n' >> "$tmp" || { persistent_lock_release "$workdir"; rm -f -- "$tmp"; return 1; }
  mv -f -- "$tmp" "$manifest" || { persistent_lock_release "$workdir"; rm -f -- "$tmp"; return 1; }
  persistent_lock_release "$workdir"
}

nested_cmd_persistent_cleanup() {
  local workdir="$1"
  shift
  [[ $# -eq 0 ]] || { echo "error: persistent-cleanup takes no arguments (identity comes only from the manifest record)" >&2; exit 1; }
  local tool
  for tool in busctl jq grep mktemp cp mv rm mkdir rmdir readlink bash; do
    command -v "$tool" >/dev/null 2>&1 || {
      echo "error: required tool '$tool' not found in PATH" >&2
      exit 1
    }
  done
  nested_require_enabled
  [[ "$PERSISTENT_PLUGIN" == poc3-persistent-adapter ]] || {
    echo "error: refusing to operate on unexpected plugin id '$PERSISTENT_PLUGIN'" >&2
    exit 1
  }
  [[ "$NESTED_MANUAL_CLIENTS_SH" == "$REPO_ROOT/scripts/nested-manual-clients.sh" ]] || {
    echo "error: manual-client helper override is rejected (expected $REPO_ROOT/scripts/nested-manual-clients.sh)" >&2
    exit 1
  }
  [[ -f "$NESTED_MANUAL_CLIENTS_SH" && ! -L "$NESTED_MANUAL_CLIENTS_SH" ]] || {
    echo "error: manual-client cleanup helper is unavailable or symlinked" >&2
    exit 1
  }
  nested_validate_manifest "$workdir" || exit 1
  nested_load_private_state "$workdir" || exit 1
  local manifest="$NESTED_WORKDIR/manifest" plugin script_id owner generation nonce pids
  plugin="$(nested_manifest_get "$manifest" persistent_plugin)" || { echo "error: no retained persistent enroll identity in manifest; refusing unrecorded cleanup" >&2; exit 1; }
  script_id="$(nested_manifest_get "$manifest" persistent_script_id)" || { echo "error: no retained persistent enroll identity in manifest; refusing unrecorded cleanup" >&2; exit 1; }
  owner="$(nested_manifest_get "$manifest" persistent_owner)" || { echo "error: persistent enroll association is partial (missing owner); refusing ambiguous cleanup" >&2; exit 1; }
  generation="$(nested_manifest_get "$manifest" persistent_generation)" || { echo "error: persistent enroll association is partial (missing generation); refusing ambiguous cleanup" >&2; exit 1; }
  nonce="$(nested_manifest_get "$manifest" persistent_nonce)" || { echo "error: persistent enroll association is partial (missing nonce); refusing ambiguous cleanup" >&2; exit 1; }
  pids="$(nested_manifest_get "$manifest" persistent_pids)" || { echo "error: persistent enroll association is partial (missing pids); refusing ambiguous cleanup" >&2; exit 1; }
  [[ "$plugin" == "$PERSISTENT_PLUGIN" ]] || { echo "error: manifest enroll plugin '$plugin' does not match '$PERSISTENT_PLUGIN'; refusing ambiguous cleanup" >&2; exit 1; }
  [[ "$script_id" =~ ^[0-9]+$ && "$script_id" -le 2147483647 ]] || { echo "error: manifest enroll script id is invalid; refusing ambiguous cleanup" >&2; exit 1; }
  valid_owner "$owner" || { echo "error: manifest enroll owner is invalid; refusing ambiguous cleanup" >&2; exit 1; }
  valid_token "$generation" || { echo "error: manifest enroll generation is invalid; refusing ambiguous cleanup" >&2; exit 1; }
  valid_token "$nonce" || { echo "error: manifest enroll nonce is invalid; refusing ambiguous cleanup" >&2; exit 1; }
  [[ "$pids" =~ ^[1-9][0-9]*,[1-9][0-9]*,[1-9][0-9]*$ ]] || { echo "error: manifest enroll pids are invalid; refusing ambiguous cleanup" >&2; exit 1; }
  persistent_validate_trio_binding "$manifest" "$NESTED_WORKDIR" || exit 1
  local current_pids
  current_pids="$(persistent_load_manual_pids "$manifest")" || exit 1
  [[ "$current_pids" == "$pids" ]] || { echo "error: manual PIDs changed since enroll (expected $pids, found $current_pids); refusing stale cleanup" >&2; exit 1; }
  nested_validate_manifest "$workdir" || exit 1
  nested_load_private_state "$workdir" || exit 1
  NESTED_KWIN_PID="$(nested_find_kwin_pid)" || {
    echo "error: could not identify one nested KWin process in the manifest-bound bus scope" >&2
    exit 1
  }
  KWIN_PID="$NESTED_KWIN_PID"
  nested_refuse_when_production_loaded
  # Retry-safe unload: when a previous attempt already verified unload
  # (record flag plus adapter verified not-loaded), do not call unload again;
  # proceed directly to the retained trio close.
  local unload_already="0"
  if grep -q -e '^persistent_unload_verified=1$' -- "$manifest" 2>/dev/null; then
    if [[ "$(nested_loaded_word "$plugin" 2>/dev/null)" == not-loaded ]]; then
      unload_already="1"
    fi
  fi
  if [[ "$unload_already" == "1" ]]; then
    printf 'enroll-cleanup: unload already verified plugin=%s script-id=%s; proceeding to trio close\n' "$plugin" "$script_id"
  else
    if ! persistent_exact_unload "$script_id"; then
      echo "error: exact enroll cleanup was not verified for plugin=$plugin script-id=$script_id" >&2
      exit 1
    fi
    printf 'enroll-cleanup: unloaded plugin=%s script-id=%s verified not-loaded\n' "$plugin" "$script_id"
    # Retain the full enroll record (plus unload proof) until trio verifies.
    persistent_mark_unload_verified "$manifest" || exit 1
  fi
  nested_validate_manifest "$workdir" || exit 1
  nested_load_private_state "$workdir" || exit 1
  if ! bash "$NESTED_MANUAL_CLIENTS_SH" cleanup "$NESTED_WORKDIR"; then
    echo "error: diagnostic trio exact close was not verified after verified unload of plugin=$plugin script-id=$script_id; enroll record retained with unload verified/trio pending (retry persistent-cleanup WORKDIR)" >&2
    printf 'enroll-cleanup: unload verified trio pending plugin=%s script-id=%s\n' "$plugin" "$script_id" >&2
    exit 1
  fi
  persistent_clear_record "$manifest" || exit 1
  nested_validate_manifest "$workdir" || exit 1
  printf 'enroll-cleanup: done plugin=%s script-id=%s unload=verified trio=verified cleared\n' "$plugin" "$script_id"
}
# PERSISTENT-ENROLL ROUTE END

host_require_enabled() {
  [[ "${POC3_HOST_ALLOW:-0}" == 1 ]] || {
    echo "error: host POC3 command transport is disabled by default (set POC3_HOST_ALLOW=1 to enable)" >&2
    exit 1
  }
}

cmd_run() {
  host_require_enabled
  require_tools node busctl jq journalctl
  local cmd="$1"
  shift
  [[ "$PLUGIN" == poc3-manual-command ]] || {
    echo "error: refusing to operate on unexpected plugin id '$PLUGIN'" >&2
    exit 1
  }
  [[ "$BUNDLE" == "$KWIN_DIR"/dist/poc3-manual-command.js ]] || {
    echo "error: refusing to build to an unexpected bundle path" >&2
    exit 1
  }
  [[ -f "$BUILD_HELPER" && ! -L "$BUILD_HELPER" ]] || {
    echo "error: command build helper is unavailable or symlinked: $BUILD_HELPER" >&2
    exit 1
  }
  trap 'signal_during_command INT' INT
  trap 'signal_during_command TERM' TERM
  parse_command_args "$cmd" "$@"
  node "$BUILD_HELPER" "${HELPER_ARGS[@]}" --out "$BUNDLE" || {
    echo "error: command bundle build failed" >&2
    exit 1
  }
  [[ -f "$BUNDLE" && ! -L "$BUNDLE" ]] || {
    echo "error: command bundle was not created at the expected dist path" >&2
    exit 1
  }
  # Coexistence guard (read-only): refuse while production is loaded, without
  # touching it. Checked after the harmless local build, before any KWin load.
  refuse_when_production_loaded
  if [[ "$(loaded_word "$PLUGIN")" == loaded ]]; then
    echo "error: plugin '$PLUGIN' is already loaded; refusing to load again" >&2
    exit 1
  fi
  KWIN_PID="$(find_kwin_pid)" || {
    echo "error: could not identify one KWin process" >&2
    exit 1
  }
  local journal_cursor_out load_out script_obj introspect_out journal_out attempt done_marker
  journal_cursor_out="$(journalctl --user --quiet --show-cursor -n 1)" || {
    echo "error: could not capture the pre-load journal cursor" >&2
    exit 1
  }
  JOURNAL_CURSOR="${journal_cursor_out##*-- cursor: }"
  if [[ -z "$JOURNAL_CURSOR" || "$JOURNAL_CURSOR" == "$journal_cursor_out" ]]; then
    echo "error: journal cursor output did not contain an opaque cursor token" >&2
    exit 1
  fi
  load_out="$(busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE loadScript ss "$BUNDLE" "$PLUGIN")" || {
    echo "error: loadScript call failed: $load_out" >&2
    exit 1
  }
  strict_json_matches "$load_valid" "$load_out" || {
    echo "error: unexpected loadScript reply: $load_out" >&2
    exit 1
  }
  SCRIPT_ID="$(jq -r '.data[0]' <<<"$load_out")"
  script_obj="/Scripting/Script$SCRIPT_ID"
  introspect_out="$(busctl $BUS_SCOPE --json=short introspect "$BUS_DEST" "$script_obj")" || {
    echo "error: introspect failed for $script_obj" >&2
    if cleanup_loaded; then echo "command: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "command: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
    exit 1
  }
  strict_json_matches "$script_iface_valid" "$introspect_out" || {
    echo "error: $script_obj does not expose the org.kde.kwin.Script interface" >&2
    if cleanup_loaded; then echo "command: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "command: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
    exit 1
  }
  if [[ "$(loaded_word "$PLUGIN")" != loaded ]]; then
    echo "error: plugin '$PLUGIN' was not reported loaded after exact object introspection" >&2
    if cleanup_loaded; then echo "command: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "command: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
    exit 1
  fi
  if ! busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$script_obj" $BUS_SCRIPT_IFACE run >/dev/null 2>&1; then
    echo "error: run() failed on $script_obj" >&2
    if cleanup_loaded; then echo "command: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "command: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
    exit 1
  fi
  done_marker="poc3-command-done:$DONE_TOKEN"
  for ((attempt = 0; attempt < READINESS_ATTEMPTS; attempt += 1)); do
    journal_out="$(journalctl --user --quiet --no-pager --after-cursor="$JOURNAL_CURSOR" "_PID=$KWIN_PID" -o json 2>/dev/null || true)"
    if jq -s -e --arg pid "$KWIN_PID" --arg done "$done_marker" "$done_valid" <<<"$journal_out" >/dev/null 2>&1; then
      trap - INT TERM
      local detail
      detail="$(jq -s -r --arg pid "$KWIN_PID" --arg done "$done_marker" '[.[] | select(((._PID? // "") == $pid) and ((.MESSAGE? | type) == "string") and (.MESSAGE | contains($done))) | .MESSAGE] | last // ""' <<<"$journal_out")"
      if cleanup_loaded; then
        printf 'command: done pid=%s script-id=%s plugin=%s nonce=%s outcome=%s\n' "$KWIN_PID" "$SCRIPT_ID" "$PLUGIN" "$DONE_TOKEN" "$detail"
        exit 0
      else
        echo "command: done but exact unload was not verified" >&2
        exit 1
      fi
    fi
    sleep "$READINESS_DELAY"
  done
  echo "error: command completion diagnostic was not confirmed for current KWin PID" >&2
  if cleanup_loaded; then echo "command: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "command: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
  exit 1
}

if [[ $# -eq 1 && ("$1" == --help || "$1" == help) ]]; then
  usage
  exit 0
fi
if [[ $# -ge 3 && "$1" == nested ]]; then
  nested_workdir="$2"
  shift 2
  nested_cmd_run "$nested_workdir" "$@"
elif [[ $# -ge 1 && ("$1" == start || "$1" == focus || "$1" == move || "$1" == status || "$1" == stop) ]]; then
  cmd_run "$@"
else
  usage >&2
  exit 1
fi
