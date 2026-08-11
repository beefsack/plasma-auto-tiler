#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
KWIN_DIR="$REPO_ROOT/kwin"
BUNDLE="$KWIN_DIR/contents/code/main.js"
META="$KWIN_DIR/metadata.json"

BUS_SCOPE="--user"
BUS_DEST="org.kde.KWin"
BUS_PATH="/Scripting"
BUS_SCRIPTING_IFACE="org.kde.kwin.Scripting"
BUS_SCRIPT_IFACE="org.kde.kwin.Script"

KG_DEST="org.kde.kglobalaccel"
KG_PATH="/kglobalaccel"
KG_IFACE="org.kde.KGlobalAccel"
KG_COMP_IFACE="org.kde.kglobalaccel.Component"

PLUGIN_ID=""
SCRIPT_ID=""
KWIN_PID=""
JOURNAL_CURSOR=""

# The exact project action IDs this lifecycle interface owns.
PROJECT_ACTIONS=(
  plasma-auto-tiler-insert-right
  plasma-auto-tiler-focus-left
  plasma-auto-tiler-focus-down
  plasma-auto-tiler-focus-up
  plasma-auto-tiler-focus-right
  plasma-auto-tiler-move-left
  plasma-auto-tiler-move-down
  plasma-auto-tiler-move-up
  plasma-auto-tiler-move-right
  plasma-auto-tiler-apply-columns
  plasma-auto-tiler-apply-rows
  plasma-auto-tiler-apply-balanced-grid
)
PROJECT_ACTIONS_JSON=""

# Strict JSON envelope predicates (jq).
isloaded_valid='((keys | sort) == ["data","type"]) and (.type == "b") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "boolean")'
load_valid='((keys | sort) == ["data","type"]) and (.type == "i") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "number") and ((.data[0] | floor) == .data[0]) and ((.data[0] >= 0) and (.data[0] <= 2147483647))'
script_iface_valid='any(.[]; ((.type == "interface") and (.name == "org.kde.kwin.Script")))'
unload_valid="$isloaded_valid"
components_valid='((keys | sort) == ["data","type"]) and (.type == "ao") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "array") and (all(.data[0][]; (. | type) == "string"))'
shortcut_infos_valid='((keys | sort) == ["data","type"]) and (.type == "a(ssssssaiai)") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "array") and (all(.data[0][]; ((. | length) == 8) and ((.[0] | type) == "string") and ((.[1] | type) == "string") and ((.[2] | type) == "string") and ((.[3] | type) == "string") and ((.[4] | type) == "string") and ((.[5] | type) == "string") and ((.[6] | type) == "array") and (all(.[6][]; (. | type) == "number")) and ((.[7] | type) == "array") and (all(.[7][]; (. | type) == "number"))))'
# Slurp-mode predicates (jq -s) over journalctl JSON-lines output.
journal_lines_valid='all(.[]; type == "object")'
readiness_valid='[.[] | select((.MESSAGE? | type) == "string") | .MESSAGE] as $messages | ($messages | index("plasma-auto-tiler:shortcut-registered")) as $registered | ($messages | index("plasma-auto-tiler:startup-handlers-ready")) as $ready | ($messages | any(startswith("plasma-auto-tiler:disabled:"))) as $disabled | ($registered != null and $ready != null and $registered < $ready and ($disabled | not))'
readiness_evidence_valid='[.[] | select((.MESSAGE? | type) == "string") | .MESSAGE] as $messages | (($messages | any(. == "plasma-auto-tiler:shortcut-registered")) and ($messages | any(. == "plasma-auto-tiler:startup-handlers-ready")))'
disabled_seen_valid='[.[] | select((.MESSAGE? | type) == "string") | .MESSAGE] | any(startswith("plasma-auto-tiler:disabled:"))'

# Bounded deterministic readiness wait: fixed attempt count and fixed delay.
READINESS_ATTEMPTS=30
READINESS_DELAY=0.1

usage() {
  cat <<'EOF'
usage: start-test.sh <command> [--help]

Manual lifecycle interface for the plasma-auto-tiler-kwin KWin script.

Commands:
  start    build the kwin bundle, load and run plasma-auto-tiler through
           KWin's /Scripting D-Bus interface, and confirm controller
           readiness from same-KWin-PID ordered diagnostics
  status   report the exact plugin load state, controller readiness
           evidence, and persisted KGlobalAccel action records
  stop     unload the exact plugin and report any persisted action records

  --help   show this help and exit

start mutates live KWin state and still requires explicit authorization.
stop/unload does not roll back Custom Tile changes the script already made.
KGlobalAccel records persist after unload and do not prove live callbacks.
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

read_plugin_id() {
  PLUGIN_ID="$(jq -r '.KPlugin.Id' "$META")" || {
    echo "error: could not read KPlugin.Id from $META" >&2
    exit 1
  }
  if [[ -z "$PLUGIN_ID" || "$PLUGIN_ID" == "null" ]]; then
    echo "error: missing KPlugin.Id in $META" >&2
    exit 1
  fi
  if [[ "$PLUGIN_ID" != "plasma-auto-tiler-kwin" ]]; then
    echo "error: refusing to operate on unexpected plugin id '$PLUGIN_ID' (expected plasma-auto-tiler-kwin)" >&2
    exit 1
  fi
}

cleanup_after_load() {
  local msg="$1"
  if [[ -n "$SCRIPT_ID" ]]; then
    busctl $BUS_SCOPE call "$BUS_DEST" "/Scripting/Script$SCRIPT_ID" $BUS_SCRIPT_IFACE stop >/dev/null 2>&1 || true
  fi
  busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE unloadScript s "$PLUGIN_ID" >/dev/null 2>&1 || true
  echo "error: $msg" >&2
  echo "note: best-effort stop/unload of '$PLUGIN_ID' attempted after the failed load" >&2
  exit 1
}

find_kwin_pid() {
  local pid command candidate=""
  while IFS=' ' read -r pid command; do
    if [[ "$command" != *" --wayland-fd "* ]]; then
      continue
    fi
    if [[ -n "$candidate" ]]; then
      return 1
    fi
    candidate="$pid"
  done < <(pgrep -a kwin_wayland)
  if [[ -z "$candidate" ]]; then
    return 1
  fi
  printf '%s\n' "$candidate"
}

# Prints "loaded" or "not-loaded"; fails the script on transport or shape errors.
plugin_loaded_word() {
  local out
  out="$(busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE isScriptLoaded s "$PLUGIN_ID")" || {
    echo "error: isScriptLoaded call failed: $out" >&2
    exit 1
  }
  if ! jq -e "$isloaded_valid" <<<"$out" >/dev/null 2>&1; then
    echo "error: unexpected isScriptLoaded reply: $out" >&2
    exit 1
  fi
  if [[ "$(jq -r '.data[0]' <<<"$out")" == "true" ]]; then
    printf 'loaded\n'
  else
    printf 'not-loaded\n'
  fi
}

ensure_actions_json() {
  if [[ -z "$PROJECT_ACTIONS_JSON" ]]; then
    PROJECT_ACTIONS_JSON="$(printf '%s\n' "${PROJECT_ACTIONS[@]}" | jq -R -s -c 'split("\n") | map(select(length > 0))')"
  fi
}

# Prints one TSV line per persisted project action record:
# component<TAB>action<TAB>label<TAB>active<TAB>default.
# Fail-closed: malformed envelopes are an error, never zero matches.
collect_project_action_records() {
  local comps comp infos
  ensure_actions_json
  comps="$(busctl $BUS_SCOPE --json=short call "$KG_DEST" "$KG_PATH" "$KG_IFACE" allComponents)" || {
    echo "error: KGlobalAccel allComponents call failed: $comps" >&2
    return 1
  }
  if ! jq -e "$components_valid" <<<"$comps" >/dev/null 2>&1; then
    echo "error: unexpected allComponents reply: $comps" >&2
    return 1
  fi
  while IFS= read -r comp; do
    infos="$(busctl $BUS_SCOPE --json=short call "$KG_DEST" "$comp" "$KG_COMP_IFACE" allShortcutInfos s default)" || {
      echo "error: allShortcutInfos call failed for $comp: $infos" >&2
      return 1
    }
    if ! jq -e "$shortcut_infos_valid" <<<"$infos" >/dev/null 2>&1; then
      echo "error: unexpected allShortcutInfos reply for $comp" >&2
      return 1
    fi
    jq -r --argjson actions "$PROJECT_ACTIONS_JSON" \
      '.data[0][] | select((.[0] as $id | $actions | index($id)) != null) | [.[2], .[0], .[1], (.[6] | join(",")), (.[7] | join(","))] | @tsv' \
      <<<"$infos" || {
      echo "error: could not filter project action records for $comp" >&2
      return 1
    }
  done < <(jq -r '.data[0][]' <<<"$comps")
}

print_records() {
  local records="$1"
  local comp action label active default
  if [[ -z "$records" ]]; then
    return 0
  fi
  while IFS=$'\t' read -r comp action label active default; do
    printf '  component "%s" action "%s" label "%s" active "%s" default "%s"\n' "$comp" "$action" "$label" "$active" "$default"
  done <<<"$records"
}

count_records() {
  local records="$1"
  printf '%s\n' "$records" | awk 'NF { n++ } END { print n+0 }'
}

cmd_start() {
  require_tools npm busctl jq journalctl pgrep
  read_plugin_id

  if ! ( cd "$KWIN_DIR" && npm run build ); then
    echo "error: npm run build failed in $KWIN_DIR" >&2
    exit 1
  fi
  if [[ ! -f "$BUNDLE" ]]; then
    echo "error: bundle not found after build: $BUNDLE" >&2
    exit 1
  fi

  local is_loaded_out
  is_loaded_out="$(busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE isScriptLoaded s "$PLUGIN_ID")" || {
    echo "error: isScriptLoaded call failed: $is_loaded_out" >&2
    exit 1
  }
  if ! jq -e "$isloaded_valid" <<<"$is_loaded_out" >/dev/null 2>&1; then
    echo "error: unexpected isScriptLoaded reply: $is_loaded_out" >&2
    exit 1
  fi
  if [[ "$(jq -r '.data[0]' <<<"$is_loaded_out")" == "true" ]]; then
    echo "error: plugin '$PLUGIN_ID' is already loaded; refusing to load again" >&2
    echo "unload it first:" >&2
    echo "  $0 stop" >&2
    exit 1
  fi

  KWIN_PID="$(find_kwin_pid)" || {
    echo "error: could not identify one KWin process for readiness diagnostics" >&2
    exit 1
  }

  local journal_cursor_out
  journal_cursor_out="$(journalctl --user --quiet --show-cursor -n 1)" || {
    echo "error: could not capture the pre-load journal cursor" >&2
    exit 1
  }
  JOURNAL_CURSOR="${journal_cursor_out##*-- cursor: }"
  if [[ -z "$JOURNAL_CURSOR" || "$JOURNAL_CURSOR" == "$journal_cursor_out" ]]; then
    echo "error: journal cursor output did not contain an opaque cursor token" >&2
    exit 1
  fi

  local load_out
  load_out="$(busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE loadScript ss "$BUNDLE" "$PLUGIN_ID")" || {
    echo "error: loadScript call failed: $load_out" >&2
    exit 1
  }
  if ! jq -e "$load_valid" <<<"$load_out" >/dev/null 2>&1; then
    cleanup_after_load "loadScript reply is not a strict {\"type\":\"i\",\"data\":[ID]}: $load_out"
  fi

  SCRIPT_ID="$(jq -r '.data[0]' <<<"$load_out")"
  local script_obj="/Scripting/Script$SCRIPT_ID"

  local introspect_out
  introspect_out="$(busctl $BUS_SCOPE --json=short introspect "$BUS_DEST" "$script_obj")" || {
    cleanup_after_load "introspect failed for $script_obj"
  }
  if ! jq -e "$script_iface_valid" <<<"$introspect_out" >/dev/null 2>&1; then
    cleanup_after_load "$script_obj does not expose the org.kde.kwin.Script interface"
  fi

  if ! busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$script_obj" $BUS_SCRIPT_IFACE run >/dev/null 2>&1; then
    cleanup_after_load "run() failed on $script_obj"
  fi

  # KWin's console output can reach the user journal just after run() returns.
  # Wait for ordered same-KWin-PID readiness diagnostics within a bounded
  # deterministic window. The pre-load cursor prevents old/unrelated messages
  # being accepted, and a disabled diagnostic fails immediately.
  local attempt journal_out
  for ((attempt = 1; attempt <= READINESS_ATTEMPTS; attempt += 1)); do
    journal_out="$(journalctl --user --quiet --no-pager --after-cursor="$JOURNAL_CURSOR" "_PID=$KWIN_PID" -o json)" || {
      cleanup_after_load "could not read KWin readiness diagnostics"
    }
    if ! jq -s -e "$journal_lines_valid" <<<"$journal_out" >/dev/null 2>&1; then
      cleanup_after_load "could not parse KWin readiness diagnostics"
    fi
    if jq -s -e "$readiness_valid" <<<"$journal_out" >/dev/null 2>&1; then
      echo "started: plugin '$PLUGIN_ID' loaded as script id $SCRIPT_ID; controller readiness confirmed"
      echo
      echo "stop it:"
      echo "  $0 stop"
      echo
      echo "inspect it:"
      echo "  $0 status"
      echo
      echo "note: stopping/unloading does not roll back Custom Tile changes the script already made."
      return 0
    fi
    if jq -s -e "$disabled_seen_valid" <<<"$journal_out" >/dev/null 2>&1; then
      cleanup_after_load "controller disabled itself during startup"
    fi
    sleep "$READINESS_DELAY"
  done
  cleanup_after_load "controller readiness was not confirmed by KWin diagnostics within the bounded window"
}

cmd_status() {
  require_tools busctl jq journalctl pgrep
  read_plugin_id

  local loaded pid journal_out records count
  loaded="$(plugin_loaded_word)"
  echo "plugin: $PLUGIN_ID"
  echo "loaded: $loaded"
  echo "controller running/callbacks: not proven by loaded state, journal evidence, or KGlobalAccel records"

  pid="$(find_kwin_pid 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    echo "controller readiness diagnostics (same-KWin-PID journal evidence): unavailable (no single KWin process identified)"
  else
    journal_out="$(journalctl --user --quiet --no-pager "_PID=$pid" -o json)" || {
      echo "error: could not read KWin readiness diagnostics" >&2
      exit 1
    }
    if [[ -z "$journal_out" ]]; then
      echo "controller readiness diagnostics (same-KWin-PID journal evidence): not observed"
    elif ! jq -s -e "$journal_lines_valid" <<<"$journal_out" >/dev/null 2>&1; then
      echo "error: could not parse KWin readiness diagnostics" >&2
      exit 1
    elif jq -s -e "$disabled_seen_valid" <<<"$journal_out" >/dev/null 2>&1; then
      echo "controller readiness diagnostics (same-KWin-PID journal evidence): disabled diagnostic observed"
    elif jq -s -e "$readiness_evidence_valid" <<<"$journal_out" >/dev/null 2>&1; then
      echo "controller readiness diagnostics (same-KWin-PID journal evidence): observed"
    else
      echo "controller readiness diagnostics (same-KWin-PID journal evidence): not observed"
    fi
  fi

  records="$(collect_project_action_records)" || exit 1
  count="$(count_records "$records")"
  echo "project action records (KGlobalAccel): $count"
  print_records "$records"
  echo "note: KGlobalAccel records persist after unload and do not prove live callbacks."
  echo "note: journal diagnostics are historical evidence for this KWin process, not a current-liveness proof."
}

cmd_stop() {
  require_tools busctl jq
  read_plugin_id

  local loaded out records count
  loaded="$(plugin_loaded_word)"
  if [[ "$loaded" == "not-loaded" ]]; then
    echo "stop: plugin '$PLUGIN_ID' is not loaded"
  else
    out="$(busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE unloadScript s "$PLUGIN_ID")" || {
      echo "error: unloadScript call failed: $out" >&2
      exit 1
    }
    if ! jq -e "$unload_valid" <<<"$out" >/dev/null 2>&1; then
      echo "error: unexpected unloadScript reply: $out" >&2
      exit 1
    fi
    if [[ "$(jq -r '.data[0]' <<<"$out")" != "true" ]]; then
      echo "error: unloadScript returned false; plugin '$PLUGIN_ID' may still be loaded" >&2
      exit 1
    fi
    local after
    after="$(plugin_loaded_word)"
    if [[ "$after" != "not-loaded" ]]; then
      echo "error: plugin '$PLUGIN_ID' is still reported loaded after unloadScript returned true" >&2
      exit 1
    fi
    echo "stop: plugin '$PLUGIN_ID' unloaded"
  fi

  records="$(collect_project_action_records)" || exit 1
  count="$(count_records "$records")"
  echo "project action records still registered in KGlobalAccel: $count (stale; left untouched)"
  print_records "$records"
  echo "note: KGlobalAccel records do not prove live callbacks and are not unregistered by this command."
  echo "note: stopping/unloading does not roll back Custom Tile topology changes the script already made."
}

if [[ $# -eq 0 ]]; then
  echo "error: missing command (start, status, or stop)" >&2
  usage >&2
  exit 1
fi

case "${1:-}" in
  --help|-h)
    if [[ $# -ne 1 ]]; then
      echo "error: '--help' takes no arguments" >&2
      exit 1
    fi
    usage
    exit 0
    ;;
  start)
    if [[ $# -ne 1 ]]; then
      echo "error: 'start' takes no arguments" >&2
      exit 1
    fi
    cmd_start
    ;;
  status)
    if [[ $# -ne 1 ]]; then
      echo "error: 'status' takes no arguments" >&2
      exit 1
    fi
    cmd_status
    ;;
  stop)
    if [[ $# -ne 1 ]]; then
      echo "error: 'stop' takes no arguments" >&2
      exit 1
    fi
    cmd_stop
    ;;
  *)
    echo "error: unknown command '$1'" >&2
    usage >&2
    exit 1
    ;;
esac
