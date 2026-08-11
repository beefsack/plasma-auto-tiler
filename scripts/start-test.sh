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

SCRIPT_ID=""
KWIN_PID=""
JOURNAL_CURSOR=""

isloaded_valid='((((keys | sort) == ["data","type"]) and (.type == "b")) and (((.data | type) == "array") and (((.data | length) == 1) and ((.data[0] | type) == "boolean"))))'
load_valid='((((keys | sort) == ["data","type"]) and (.type == "i")) and (((.data | type) == "array") and (((.data | length) == 1) and (((.data[0] | type) == "number") and ((.data[0] | floor) == .data[0]) and ((.data[0] >= 0) and (.data[0] <= 2147483647))))))'
script_iface_valid='any(.[]; ((.type == "interface") and (.name == "org.kde.kwin.Script")))'
readiness_valid='[inputs | select((.MESSAGE? | type) == "string") | .MESSAGE] as $messages | ($messages | index("plasma-auto-tiler:shortcut-registered")) as $registered | ($messages | index("plasma-auto-tiler:startup-handlers-ready")) as $ready | ($messages | any(startswith("plasma-auto-tiler:disabled:"))) as $disabled | ($registered != null and $ready != null and $registered < $ready and ($disabled | not))'

usage() {
  cat <<'EOF'
usage: start-test.sh [--help]

Manual launcher: build the kwin bundle, load and run plasma-auto-tiler through
KWin's /Scripting D-Bus interface, then print stop/unload commands.

  --help   show this help and exit

This mutates live KWin state and still requires explicit authorization.
Stopping/unloading later does not roll back Custom Tile changes.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

for tool in npm busctl jq journalctl pgrep; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: required tool '$tool' not found in PATH" >&2
    exit 1
  fi
done

if ! ( cd "$KWIN_DIR" && npm run build ); then
  echo "error: npm run build failed in $KWIN_DIR" >&2
  exit 1
fi

if [[ ! -f "$BUNDLE" ]]; then
  echo "error: bundle not found after build: $BUNDLE" >&2
  exit 1
fi

PLUGIN_ID="$(jq -r '.KPlugin.Id' "$META")"
if [[ -z "$PLUGIN_ID" || "$PLUGIN_ID" == "null" ]]; then
  echo "error: missing KPlugin.Id in $META" >&2
  exit 1
fi

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

is_loaded_out="$(busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE isScriptLoaded s "$PLUGIN_ID")" || {
  echo "error: isScriptLoaded call failed: $is_loaded_out" >&2
  exit 1
}

if ! jq -e "$isloaded_valid" <<<"$is_loaded_out" >/dev/null; then
  echo "error: unexpected isScriptLoaded reply: $is_loaded_out" >&2
  exit 1
fi

if [[ "$(jq -r '.data[0]' <<<"$is_loaded_out")" == "true" ]]; then
  echo "error: plugin '$PLUGIN_ID' is already loaded; refusing to load again" >&2
  echo "unload it first:" >&2
  echo "  busctl --user call $BUS_DEST $BUS_PATH $BUS_SCRIPTING_IFACE unloadScript s '$PLUGIN_ID'" >&2
  exit 1
fi

KWIN_PID="$(find_kwin_pid)" || {
  echo "error: could not identify one KWin process for readiness diagnostics" >&2
  exit 1
}

journal_cursor_out="$(journalctl --user --quiet --show-cursor -n 1)" || {
  echo "error: could not capture the pre-load journal cursor" >&2
  exit 1
}
JOURNAL_CURSOR="${journal_cursor_out##*-- cursor: }"
if [[ -z "$JOURNAL_CURSOR" || "$JOURNAL_CURSOR" == "$journal_cursor_out" ]]; then
  echo "error: journal cursor output did not contain an opaque cursor token" >&2
  exit 1
fi

load_out="$(busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE loadScript ss "$BUNDLE" "$PLUGIN_ID")" || {
  echo "error: loadScript call failed: $load_out" >&2
  exit 1
}

if ! jq -e "$load_valid" <<<"$load_out" >/dev/null; then
  cleanup_after_load "loadScript reply is not a strict {\"type\":\"i\",\"data\":[ID]}: $load_out"
fi

SCRIPT_ID="$(jq -r '.data[0]' <<<"$load_out")"
SCRIPT_OBJ="/Scripting/Script$SCRIPT_ID"

introspect_out="$(busctl $BUS_SCOPE --json=short introspect "$BUS_DEST" "$SCRIPT_OBJ")" || {
  cleanup_after_load "introspect failed for $SCRIPT_OBJ"
}

if ! jq -e "$script_iface_valid" <<<"$introspect_out" >/dev/null; then
  cleanup_after_load "$SCRIPT_OBJ does not expose the org.kde.kwin.Script interface"
fi

if ! busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$SCRIPT_OBJ" $BUS_SCRIPT_IFACE run >/dev/null 2>&1; then
  cleanup_after_load "run() failed on $SCRIPT_OBJ"
fi

# KWin's console output can reach the user journal just after run() returns.
sleep 0.1
journal_out="$(journalctl --user --quiet --no-pager --after-cursor="$JOURNAL_CURSOR" "_PID=$KWIN_PID" -o json)" || {
  cleanup_after_load "could not read KWin readiness diagnostics"
}
if ! jq -s -e "$readiness_valid" <<<"$journal_out" >/dev/null; then
  cleanup_after_load "controller readiness was not confirmed by KWin diagnostics"
fi

echo "started: plugin '$PLUGIN_ID' loaded as script id $SCRIPT_ID; controller readiness confirmed"
echo
echo "stop it:"
echo "  busctl --user call $BUS_DEST $SCRIPT_OBJ $BUS_SCRIPT_IFACE stop"
echo "unload it:"
echo "  busctl --user call $BUS_DEST $BUS_PATH $BUS_SCRIPTING_IFACE unloadScript s '$PLUGIN_ID'"
echo
echo "note: stopping/unloading does not roll back Custom Tile changes the script already made."
