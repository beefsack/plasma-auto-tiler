#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
KWIN_DIR="$REPO_ROOT/kwin"
META="$KWIN_DIR/metadata.json"
BUNDLE="$KWIN_DIR/contents/code/main.js"

# KPlugin.Id from kwin/metadata.json (fixed project identity). The KWin plugin
# setting key is KPlugin.Id + "Enabled", verified against KWin source.
PLUGIN_ID="plasma-auto-tiler-kwin"
CONFIG_KEY="${PLUGIN_ID}Enabled"

# Normal roots derive from XDG paths. Test-only overrides: DOGFOOD_DATA_ROOT and
# DOGFOOD_CONFIG_ROOT point the script at a throwaway tree so shell tests never
# reach real user paths.
DATA_ROOT="${DOGFOOD_DATA_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}}"
CONFIG_ROOT="${DOGFOOD_CONFIG_ROOT:-${XDG_CONFIG_HOME:-$HOME/.config}}"
INSTALL_DIR="$DATA_ROOT/kwin/scripts/$PLUGIN_ID"
KWINRC="$CONFIG_ROOT/kwinrc"

# Host Plasma runtime prerequisites. Override each *_BIN variable to inject a
# fake executable for hermetic tests.
TOOL=""

usage() {
  cat <<'EOF'
usage: dogfood-install.sh <command> [--help]

Package management interface for the plasma-auto-tiler-kwin KWin script.

Commands:
  install    build the kwin bundle and copy the package into
             $XDG_DATA_HOME/kwin/scripts/plasma-auto-tiler-kwin/ (or
             $HOME/.local/share/kwin/scripts/plasma-auto-tiler-kwin/ when
             XDG_DATA_HOME is unset); replaces any existing plugin directory
  uninstall  remove only the installed plugin directory above
  enable     write [Plugins] plasma-auto-tiler-kwinEnabled=true through
             kwriteconfig6 and reconfigure KWin via D-Bus
  disable    write [Plugins] plasma-auto-tiler-kwinEnabled=false through
             kwriteconfig6 and reconfigure KWin via D-Bus
  status     report installed and enabled state; read-only, never mutates

  --help     show this help and exit

Runtime tool-path overrides (host Plasma prerequisites): NPM_BIN,
KWRITECONFIG6_BIN, KREADCONFIG6_BIN, QDBUS_BIN.
Test-only destination/config root overrides: DOGFOOD_DATA_ROOT,
DOGFOOD_CONFIG_ROOT.

install and uninstall never touch KWin configuration; enable and disable
mutate kwinrc and reconfigure the running KWin session.
EOF
}

# Resolves one runtime tool into the global TOOL. Uses the *_BIN override when
# set (must be executable), otherwise the same-named command in PATH. Fails
# with a clear actionable error naming the missing tool.
require_tool() {
  local var_name="$1" default_name="$2"
  local value="${!var_name:-}"
  if [[ -n "$value" ]]; then
    if [[ ! -x "$value" ]]; then
      echo "error: $var_name is set but is not an executable: $value" >&2
      exit 1
    fi
    TOOL="$value"
    return 0
  fi
  if ! command -v "$default_name" >/dev/null 2>&1; then
    echo "error: required tool '$default_name' not found in PATH; it is a host Plasma prerequisite - install it or set $var_name to its absolute path" >&2
    exit 1
  fi
  TOOL="$(command -v "$default_name")"
}

cmd_install() {
  require_tool NPM_BIN npm
  local npm="$TOOL"

  if ! ( cd "$KWIN_DIR" && "$npm" --prefix "$KWIN_DIR" run build ); then
    echo "error: npm --prefix kwin run build failed in $KWIN_DIR" >&2
    exit 1
  fi
  if [[ ! -f "$BUNDLE" ]]; then
    echo "error: bundle not found after build: $BUNDLE" >&2
    exit 1
  fi

  rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  cp "$META" "$INSTALL_DIR/metadata.json"
  cp -R "$KWIN_DIR/contents" "$INSTALL_DIR/contents"
  echo "installed: $PLUGIN_ID -> $INSTALL_DIR"
  echo "note: install does not enable the plugin; run 'dogfood-install.sh enable' to toggle the KWin plugin setting."
}

cmd_uninstall() {
  if [[ ! -e "$INSTALL_DIR" ]]; then
    echo "uninstall: nothing installed at $INSTALL_DIR"
    return 0
  fi
  rm -rf "$INSTALL_DIR"
  echo "uninstalled: removed $INSTALL_DIR"
}

cmd_set_enabled() {
  local want="$1" word="$2"
  require_tool KWRITECONFIG6_BIN kwriteconfig6
  local kwriteconfig="$TOOL"
  require_tool QDBUS_BIN qdbus
  local qdbus="$TOOL"

  if ! "$kwriteconfig" --file "$KWINRC" --group Plugins --key "$CONFIG_KEY" "$want"; then
    echo "error: kwriteconfig6 failed to set $CONFIG_KEY=$want in $KWINRC" >&2
    exit 1
  fi
  if ! "$qdbus" org.kde.KWin /KWin reconfigure; then
    echo "error: qdbus failed to reconfigure KWin (org.kde.KWin /KWin reconfigure)" >&2
    exit 1
  fi
  echo "$word: $CONFIG_KEY set to $want and KWin reconfigured"
}

cmd_enable() {
  cmd_set_enabled true enabled
}

cmd_disable() {
  cmd_set_enabled false disabled
}

cmd_status() {
  require_tool KREADCONFIG6_BIN kreadconfig6
  local kreadconfig="$TOOL"

  if [[ -d "$INSTALL_DIR" && -f "$INSTALL_DIR/metadata.json" ]]; then
    echo "installed: yes ($INSTALL_DIR)"
  else
    echo "installed: no"
  fi

  local raw
  raw="$( "$kreadconfig" --file "$KWINRC" --group Plugins --key "$CONFIG_KEY" )" || {
    echo "error: kreadconfig6 failed to read $CONFIG_KEY from $KWINRC" >&2
    exit 1
  }
  if [[ "$raw" == "true" ]]; then
    echo "enabled: yes"
  else
    echo "enabled: no"
  fi
  echo "note: status is read-only and never reconfigures KWin."
}

if [[ $# -eq 0 ]]; then
  echo "error: missing command (install, uninstall, enable, disable, or status)" >&2
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
  install)
    if [[ $# -ne 1 ]]; then
      echo "error: 'install' takes no arguments" >&2
      exit 1
    fi
    cmd_install
    ;;
  uninstall)
    if [[ $# -ne 1 ]]; then
      echo "error: 'uninstall' takes no arguments" >&2
      exit 1
    fi
    cmd_uninstall
    ;;
  enable)
    if [[ $# -ne 1 ]]; then
      echo "error: 'enable' takes no arguments" >&2
      exit 1
    fi
    cmd_enable
    ;;
  disable)
    if [[ $# -ne 1 ]]; then
      echo "error: 'disable' takes no arguments" >&2
      exit 1
    fi
    cmd_disable
    ;;
  status)
    if [[ $# -ne 1 ]]; then
      echo "error: 'status' takes no arguments" >&2
      exit 1
    fi
    cmd_status
    ;;
  *)
    echo "error: unknown command '$1'" >&2
    usage >&2
    exit 1
    ;;
esac
