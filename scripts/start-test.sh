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

isloaded_valid='((((keys | sort) == ["data","type"]) and (.type == "b")) and (((.data | type) == "array") and (((.data | length) == 1) and ((.data[0] | type) == "boolean"))))'
load_valid='((((keys | sort) == ["data","type"]) and (.type == "i")) and (((.data | type) == "array") and (((.data | length) == 1) and (((.data[0] | type) == "number") and ((.data[0] | floor) == .data[0]) and ((.data[0] >= 0) and (.data[0] <= 2147483647))))))'
script_iface_valid='any(.[]; ((.type == "interface") and (.name == "org.kde.kwin.Script")))'

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

for tool in npm busctl jq; do
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

echo "started: plugin '$PLUGIN_ID' loaded as script id $SCRIPT_ID; run() returned successfully"
echo
echo "stop it:"
echo "  busctl --user call $BUS_DEST $SCRIPT_OBJ $BUS_SCRIPT_IFACE stop"
echo "unload it:"
echo "  busctl --user call $BUS_DEST $BUS_PATH $BUS_SCRIPTING_IFACE unloadScript s '$PLUGIN_ID'"
echo
echo "note: stopping/unloading does not roll back Custom Tile changes the script already made."
