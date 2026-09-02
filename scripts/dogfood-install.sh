#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
KWIN_DIR="$REPO_ROOT/kwin"
META="$KWIN_DIR/metadata.json"
BUNDLE="$KWIN_DIR/contents/code/main.js"
KCM_SCHEMA="$KWIN_DIR/contents/config/main.xml"
KCM_UI="$KWIN_DIR/contents/ui/config.ui"

# KPlugin.Id from kwin/metadata.json (fixed project identity). The KWin plugin
# setting key is KPlugin.Id + "Enabled", verified against KWin source.
PLUGIN_ID="plasma-auto-tiler-kwin"
CONFIG_KEY="${PLUGIN_ID}Enabled"

# KPlugin.Id of the native "active border" effect plugin; matches the D-Bus
# effect name and kwin/native-effect/metadata.json's KPlugin.Id.
#
# CAUTION: KWin derives a disk-scanned plugin's *runtime* ID from the built
# .so filename (QFileInfo(fileName).completeBaseName()), NOT from
# metadata.json's Id. This constant equals metadata.json's Id only because
# kwin/native-effect/CMakeLists.txt's kcoreaddons_add_plugin target name was
# deliberately set to match, enforced at build time by
# kwin/native-effect/validate-metadata.cmake. A future rename that moves one
# without the others silently breaks EFFECT_CONFIG_KEY below. See the
# "native-effect plugin ID consistency" test in dogfood-install.test.sh.
EFFECT_PLUGIN_ID="plasma-auto-tiler-active-border"

# kwinrc [Plugins] key that persists the native effect's enabled state across
# session starts, exactly mirroring CONFIG_KEY above for the KWin script.
# Derived from EFFECT_PLUGIN_ID so there is one place this identifier is
# spelled out, not two.
EFFECT_CONFIG_KEY="${EFFECT_PLUGIN_ID}Enabled"
# KWin dev-package cmake config dir, used only when present (see
# cmd_effect_install below). DOGFOOD_KWIN_DEV_CMAKE_DIR is a test-only
# override with precedence over the development environment default.
KWIN_DEV_CMAKE_DIR="${DOGFOOD_KWIN_DEV_CMAKE_DIR:-${PLASMA_AUTO_TILER_KWIN_DEV_CMAKE_DIR:-}}"

# Normal roots derive from XDG paths. Test-only overrides: DOGFOOD_DATA_ROOT and
# DOGFOOD_CONFIG_ROOT point the script at a throwaway tree so shell tests never
# reach real user paths.
DATA_ROOT="${DOGFOOD_DATA_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}}"
CONFIG_ROOT="${DOGFOOD_CONFIG_ROOT:-${XDG_CONFIG_HOME:-$HOME/.config}}"
INSTALL_DIR="$DATA_ROOT/kwin/scripts/$PLUGIN_ID"
KWINRC="$CONFIG_ROOT/kwinrc"

EFFECT_ROOT="$DATA_ROOT/plasma-auto-tiler-native-effect"
EFFECT_SOURCE_DIR="$REPO_ROOT/kwin/native-effect"
EFFECT_STAGED_SO="$EFFECT_ROOT/kwin/effects/plugins/$EFFECT_PLUGIN_ID.so"
EFFECT_STAGED_KCM="$EFFECT_ROOT/kwin/effects/configs/plasma-auto-tiler-active-border_config.so"

# plasma-workspace's own startplasma-wayland sources every *.sh file under
# this directory into its own process environment before syncing it to the
# session (see docs/live-kwin-testing.md Native Effect Host Session-Boundary
# Exception for the mechanism). This supersedes the environment.d entry this
# project used to write (kept below only so effect-remove can migrate it away).
EFFECT_ENV_FILE="$CONFIG_ROOT/plasma-workspace/env/60-plasma-auto-tiler-native-effect.sh"
LEGACY_EFFECT_ENV_FILE="$CONFIG_ROOT/environment.d/60-plasma-auto-tiler-native-effect.conf"

# Host Plasma runtime prerequisites. Override each *_BIN variable to inject a
# fake executable for hermetic tests.
TOOL=""

usage() {
  cat <<'EOF'
usage: dogfood-install.sh <command> [--help]

Package management interface for the plasma-auto-tiler-kwin KWin script.
The generic scripted KCM is retired; the native effect-scoped KCM is the sole
settings owner through Desktop Effects, with no compatibility or migration
route.

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
  reload     disable then re-enable the script, reconfiguring KWin after each
              change so it replaces the running in-memory script instance
  status     report installed and enabled state; read-only, never mutates
  dry-run    inspect source package metadata, bundle, KCM schema/UI, and
             destination install/enabled state; lists intended install
             actions; read-only, never mutates

  effect-install  build the native "active border" effect and its QWidget KCM,
                   staging them under
                   $XDG_DATA_HOME/plasma-auto-tiler-native-effect/kwin/effects/
                  (plugins/ and configs/, or the $HOME/.local/share equivalent
                  when XDG_DATA_HOME is unset); writes a QT_PLUGIN_PATH env script under
                  $XDG_CONFIG_HOME/plasma-workspace/env/ so the staged plugin
                  dir is discovered on next login; also writes
                  [Plugins] plasma-auto-tiler-active-borderEnabled=true to
                  kwinrc so the effect persists across future session starts
                  once discovered (does not reconfigure KWin or use D-Bus);
                  idempotent
  effect-reload   query D-Bus for effect support; if supported, unload and
                   reload the effect live; if unsupported, reports the
                   ambiguous unavailable state and exits non-zero without
                   attempting load/unload
  effect-status   staged diagnostic: staging, env script, session delivery
                  (reads the running kwin_wayland process's own environment),
                  D-Bus discovery, and D-Bus loaded state, each reported
                  pass/fail with guidance; read-only, never mutates
  effect-remove   remove the staged effect tree, the plasma-workspace env
                  script, the kwinrc [Plugins]
                  plasma-auto-tiler-active-borderEnabled key when present, and
                   (migration cleanup) any legacy environment.d entry this
                   project wrote previously; refuses to remove a loaded effect
                   and is otherwise transactional

  setup      one-command install: composes install, enable, effect-install,
             and effect-reload in that order. install/enable are the
             required half and abort setup on real failure. effect-install
              and effect-reload are optional and degrade gracefully: a
              missing build toolchain (e.g. not inside 'devenv shell
              --impure') or an effect-reload failure are reported, not treated
              as failures.
             setup exits 0 whenever install and enable both succeeded, and
             always prints a per-stage summary plus what remains manual.

  --help     show this help and exit

Runtime tool-path overrides: NPM_BIN, KWRITECONFIG6_BIN, KREADCONFIG6_BIN,
QDBUS_BIN, JQ_BIN, CMAKE_BIN.
Test-only destination/config root overrides: DOGFOOD_DATA_ROOT,
DOGFOOD_CONFIG_ROOT. Test-only effect-status session-delivery overrides:
DOGFOOD_KWIN_ENVIRON_FILE (read this path instead of scanning /proc),
DOGFOOD_KWIN_NOT_RUNNING (force the "process not found" branch).
Test-only effect-install override: DOGFOOD_KWIN_DEV_CMAKE_DIR (overrides the
default -DKWin_DIR= path used only when it exists on disk).

install and uninstall never touch KWin configuration; enable, disable, and
reload mutate kwinrc and reconfigure the running KWin session.
effect-install and effect-remove touch kwinrc (only the one [Plugins]
enablement key for the native effect) but never use D-Bus; effect-reload is
the only effect command that mutates the running KWin session via D-Bus.
effect-remove performs one read-only D-Bus loaded-state query and fails closed
if the effect is loaded; effect-status is read-only.
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

cmd_reload() {
  cmd_disable
  cmd_enable
  echo "reloaded: $PLUGIN_ID is enabled with a fresh KWin script instance"
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

cmd_dry_run() {
  require_tool JQ_BIN jq
  local jq="$TOOL"
  require_tool KREADCONFIG6_BIN kreadconfig6
  local kreadconfig="$TOOL"

  local missing=()
  [[ -f "$META" ]] || missing+=("$META")
  [[ -f "$BUNDLE" ]] || missing+=("$BUNDLE")
  [[ -f "$KCM_SCHEMA" ]] || missing+=("$KCM_SCHEMA")
  [[ -f "$KCM_UI" ]] || missing+=("$KCM_UI")
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "error: dry-run requires source data that is missing:" >&2
    for path in "${missing[@]}"; do
      echo "  - $path" >&2
    done
    echo "error: run 'install' to rebuild the bundle or restore the missing source files before dry-run" >&2
    exit 1
  fi

  local plugin_id
  plugin_id="$( "$jq" -r '.KPlugin.Id // empty' "$META" 2>/dev/null )" || {
    echo "error: metadata.json is not valid JSON: $META" >&2
    exit 1
  }
  if [[ "$plugin_id" != "$PLUGIN_ID" ]]; then
    echo "error: metadata.json KPlugin.Id is '$plugin_id'; expected '$PLUGIN_ID'" >&2
    exit 1
  fi

  echo "source metadata: valid (KPlugin.Id=$PLUGIN_ID)"
  echo "source bundle: present ($BUNDLE)"
  echo "KCM schema: present ($KCM_SCHEMA)"
  echo "KCM UI: present ($KCM_UI)"

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

  echo "intended actions:"
  echo "  - build the kwin bundle (npm --prefix $KWIN_DIR run build)"
  echo "  - replace any existing plugin directory at $INSTALL_DIR"
  echo "  - copy metadata.json and contents/ into $INSTALL_DIR"
  echo "note: dry-run is read-only and never builds, copies, writes configuration, reconfigures KWin, or reconciles shortcuts."
}

effect_env_file_contents() {
  # Sourced by /bin/sh (startplasma-wayland's runEnvironmentScripts()), so
  # this must be POSIX sh, not bash. ${QT_PLUGIN_PATH:+:$QT_PLUGIN_PATH}
  # prepends our staging root and preserves any existing value; it emits no
  # stray leading/trailing colon when QT_PLUGIN_PATH is unset. Verified
  # against dash/POSIX sh semantics, not just bash.
  printf 'export QT_PLUGIN_PATH="%s${QT_PLUGIN_PATH:+:$QT_PLUGIN_PATH}"\n' "$EFFECT_ROOT"
}

effect_install_rollback() {
  [[ "${install_cleanup_done:-0}" -eq 0 ]] || return 0
  install_cleanup_done=1
  local ok=0
  if [[ "${install_new_env_moved:-0}" -eq 1 ]]; then
    rm -f -- "$EFFECT_ENV_FILE" || ok=1
  fi
  if [[ "${install_old_env_moved:-0}" -eq 1 ]]; then
    mv -- "$install_env_backup" "$EFFECT_ENV_FILE" || ok=1
  fi
  if [[ "${install_new_root_moved:-0}" -eq 1 ]]; then
    rm -rf -- "$EFFECT_ROOT" || ok=1
  fi
  if [[ "${install_old_root_moved:-0}" -eq 1 ]]; then
    mv -- "$install_root_backup" "$EFFECT_ROOT" || ok=1
  fi
  if [[ "${install_config_snapshot:-0}" -eq 1 ]]; then
    if [[ "${install_config_had_file:-0}" -eq 1 ]]; then
      cp -p -- "$install_config_backup" "$KWINRC" || ok=1
    else
      rm -f -- "$KWINRC" || ok=1
    fi
  fi
  [[ -z "${install_transaction:-}" ]] || rm -rf -- "$install_transaction" || ok=1
  return "$ok"
}

effect_install_signal() {
  install_pending_signal="$1"
}

effect_install_check_signal() {
  local signal="${install_pending_signal:-}"
  [[ -z "$signal" ]] || {
    install_pending_signal=""
    case "$signal" in
      INT) effect_install_abort "interrupted by SIGINT" 130 ;;
      TERM) effect_install_abort "interrupted by SIGTERM" 143 ;;
      HUP) effect_install_abort "interrupted by SIGHUP" 129 ;;
    esac
  }
}

effect_install_cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  if [[ -n "${install_transaction:-}" && "${install_cleanup_done:-0}" -eq 0 ]]; then
    trap '' INT TERM HUP
    local rollback_status=0
    effect_install_rollback || rollback_status=$?
    trap - INT TERM HUP
    if [[ "$rollback_status" -ne 0 ]]; then
      echo "error: interrupted or failed native-effect install; rollback failed - inspect $EFFECT_ROOT, $EFFECT_ENV_FILE, and $KWINRC" >&2
    fi
  fi
  return "$status"
}

effect_install_abort() {
  local message="$1"
  local status="${2:-1}"
  trap - EXIT INT TERM HUP
  trap '' INT TERM HUP
  local rollback_status=0
  effect_install_rollback || rollback_status=$?
  trap - INT TERM HUP
  if [[ "$rollback_status" -ne 0 ]]; then
    echo "error: $message; rollback failed - inspect $EFFECT_ROOT, $EFFECT_ENV_FILE, and $KWINRC" >&2
  else
    echo "error: $message" >&2
  fi
  exit "$status"
}

cmd_effect_install() {
  require_tool CMAKE_BIN cmake
  local cmake="$TOOL"
  require_tool KWRITECONFIG6_BIN kwriteconfig6
  local kwriteconfig="$TOOL"
  local effect_install_needs_boundary=0
  if [[ ! -e "$EFFECT_ENV_FILE" && ! -L "$EFFECT_ENV_FILE" ]]; then
    effect_install_needs_boundary=1
  fi

  mkdir -p "$DATA_ROOT" || {
    echo "error: could not create data root: $DATA_ROOT" >&2
    exit 1
  }
  local install_transaction
  install_transaction="$(mktemp -d "$DATA_ROOT/.plasma-auto-tiler-native-effect.XXXXXX")" || {
    echo "error: could not create native-effect transaction directory under $DATA_ROOT" >&2
    exit 1
  }
  local install_build_dir="$install_transaction/build"
  local install_payload="$install_transaction/payload"
  local install_root_backup="$install_transaction/previous-root"
  local install_env_backup="$install_transaction/previous-env"
  local install_config_backup="$install_transaction/previous-kwinrc"
  local install_old_root_moved=0 install_new_root_moved=0
  local install_old_env_moved=0 install_new_env_moved=0
  local install_config_snapshot=0 install_config_had_file=0
  local install_cleanup_done=0 install_pending_signal=""
  trap 'effect_install_signal INT' INT
  trap 'effect_install_signal TERM' TERM
  trap 'effect_install_signal HUP' HUP
  trap 'effect_install_cleanup' EXIT

  local cmake_args=(-S "$EFFECT_SOURCE_DIR" -B "$install_build_dir")
  if [[ -d "$KWIN_DEV_CMAKE_DIR" ]]; then
    cmake_args+=(-DKWin_DIR="$KWIN_DEV_CMAKE_DIR")
  fi
  cmake_args+=(-DBUILD_TESTING=OFF)
  if ! "$cmake" "${cmake_args[@]}"; then
    effect_install_abort "cmake configure failed for $EFFECT_SOURCE_DIR"
  fi
  effect_install_check_signal
  if ! "$cmake" --build "$install_build_dir"; then
    effect_install_abort "cmake --build failed for $install_build_dir"
  fi
  effect_install_check_signal

  local built_so="$install_build_dir/bin/kwin/effects/plugins/$EFFECT_PLUGIN_ID.so"
  local built_kcm="$install_build_dir/bin/kwin/effects/configs/plasma-auto-tiler-active-border_config.so"
  if [[ ! -f "$built_so" ]]; then
    effect_install_abort "bundle not found after build: $built_so"
  fi
  if [[ ! -f "$built_kcm" ]]; then
    effect_install_abort "config module not found after build: $built_kcm"
  fi

  local install_payload_root="$install_payload/root"
  local payload_so="$install_payload_root/kwin/effects/plugins/$EFFECT_PLUGIN_ID.so"
  local payload_kcm="$install_payload_root/kwin/effects/configs/plasma-auto-tiler-active-border_config.so"
  if ! install -Dm0644 "$built_so" "$payload_so" || ! install -Dm0644 "$built_kcm" "$payload_kcm"; then
    effect_install_abort "could not prepare native-effect staging payload"
  fi
  effect_install_check_signal
  local desired
  desired="$(effect_env_file_contents)"
  printf '%s' "$desired" > "$install_transaction/env" || effect_install_abort "could not prepare native-effect environment script"
  effect_install_check_signal

  if [[ -L "$KWINRC" || ( -e "$KWINRC" && ! -f "$KWINRC" ) ]]; then
    effect_install_abort "kwinrc is not a regular file: $KWINRC"
  fi
  if [[ -f "$KWINRC" ]]; then
    if ! cp -p -- "$KWINRC" "$install_config_backup"; then
      effect_install_abort "could not snapshot kwinrc: $KWINRC"
    fi
    install_config_had_file=1
  fi
  install_config_snapshot=1
  effect_install_check_signal

  # Probe the actual kwinrc write before publishing any binary or environment state.
  if ! "$kwriteconfig" --file "$KWINRC" --group Plugins --key "$EFFECT_CONFIG_KEY" true; then
    effect_install_abort "kwriteconfig6 failed to set $EFFECT_CONFIG_KEY=true in $KWINRC"
  fi
  effect_install_check_signal

  if [[ -e "$EFFECT_ROOT" || -L "$EFFECT_ROOT" ]]; then
    if [[ -L "$EFFECT_ROOT" || ! -d "$EFFECT_ROOT" ]] || ! mv -- "$EFFECT_ROOT" "$install_root_backup"; then
      effect_install_abort "could not preserve existing native-effect staging root"
    fi
    install_old_root_moved=1
  fi
  effect_install_check_signal
  mkdir -p "$(dirname "$EFFECT_ROOT")" || effect_install_abort "could not create native-effect staging directory"
  effect_install_check_signal
  if ! mv -- "$install_payload_root" "$EFFECT_ROOT"; then
    effect_install_abort "could not publish native-effect staging root"
  fi
  install_new_root_moved=1
  effect_install_check_signal

  if [[ -e "$EFFECT_ENV_FILE" || -L "$EFFECT_ENV_FILE" ]]; then
    if [[ -L "$EFFECT_ENV_FILE" || ! -f "$EFFECT_ENV_FILE" ]] || ! mv -- "$EFFECT_ENV_FILE" "$install_env_backup"; then
      effect_install_abort "could not preserve existing native-effect environment script"
    fi
    install_old_env_moved=1
  fi
  effect_install_check_signal
  mkdir -p "$(dirname "$EFFECT_ENV_FILE")" || effect_install_abort "could not create native-effect environment directory"
  effect_install_check_signal
  if ! mv -- "$install_transaction/env" "$EFFECT_ENV_FILE"; then
    effect_install_abort "could not publish native-effect environment script"
  fi
  install_new_env_moved=1
  effect_install_check_signal

  trap - EXIT INT TERM HUP
  rm -rf -- "$install_transaction"
  install_transaction=""
  echo "staged: $EFFECT_STAGED_SO"
  echo "env script: $EFFECT_ENV_FILE"
  echo "kwinrc: $EFFECT_CONFIG_KEY set to true (persists across future session starts once the effect is discovered by KWin; this does not itself trigger a live D-Bus load - use 'effect-reload' for that)"
  if [[ "$effect_install_needs_boundary" -eq 1 ]]; then
    echo "note: a logout/login (or new session) is required before the effect is discovered by KWin."
  fi
}

cmd_effect_reload() {
  require_tool QDBUS_BIN qdbus
  local qdbus="$TOOL"

  local supported
  supported="$( "$qdbus" org.kde.KWin /Effects org.kde.kwin.Effects.isEffectSupported "$EFFECT_PLUGIN_ID" )" || {
    echo "error: qdbus failed to query isEffectSupported for $EFFECT_PLUGIN_ID" >&2
    return 2
  }
  if [[ "$supported" == "false" ]]; then
    echo "error: $EFFECT_PLUGIN_ID is unavailable to KWin (isEffectSupported=false); this result does not establish a session boundary and may indicate a plugin load, factory, or ABI failure. Run 'effect-status' and inspect KWin plugin-loading diagnostics." >&2
    return 2
  fi
  if [[ "$supported" != "true" ]]; then
    echo "error: qdbus returned an invalid isEffectSupported reply for $EFFECT_PLUGIN_ID: ${supported:-<empty>}" >&2
    return 2
  fi

  if ! "$qdbus" org.kde.KWin /Effects org.kde.kwin.Effects.unloadEffect "$EFFECT_PLUGIN_ID" >/dev/null; then
    echo "error: qdbus failed to unloadEffect $EFFECT_PLUGIN_ID" >&2
    return 2
  fi
  if ! "$qdbus" org.kde.KWin /Effects org.kde.kwin.Effects.loadEffect "$EFFECT_PLUGIN_ID" >/dev/null; then
    echo "error: qdbus failed to loadEffect $EFFECT_PLUGIN_ID" >&2
    return 2
  fi

  local loaded
  loaded="$( "$qdbus" org.kde.KWin /Effects org.kde.kwin.Effects.isEffectLoaded "$EFFECT_PLUGIN_ID" )" || {
    echo "error: qdbus failed to query isEffectLoaded for $EFFECT_PLUGIN_ID" >&2
    return 2
  }
  if [[ "$loaded" != "true" && "$loaded" != "false" ]]; then
    echo "error: qdbus returned an invalid isEffectLoaded reply for $EFFECT_PLUGIN_ID: ${loaded:-<empty>}" >&2
    return 2
  fi
  if [[ "$loaded" != "true" ]]; then
    echo "error: loadEffect did not result in $EFFECT_PLUGIN_ID being loaded" >&2
    return 2
  fi
  echo "reloaded: $EFFECT_PLUGIN_ID is loaded"
}

# Locates the running kwin_wayland process's own /proc/<pid>/environ path by
# scanning /proc/[0-9]*/cmdline for an argv0 basename of exactly
# "kwin_wayland" (cmdline is always readable regardless of the process's
# dumpable/ptrace state, unlike /proc/<pid>/{exe,environ,maps}). Prints the
# path and returns 0 if found, prints nothing and returns 1 otherwise.
# DOGFOOD_KWIN_ENVIRON_FILE and DOGFOOD_KWIN_NOT_RUNNING are test-only
# overrides so this never touches the real host /proc in the test suite.
find_kwin_environ_file() {
  if [[ -n "${DOGFOOD_KWIN_NOT_RUNNING:-}" ]]; then
    return 1
  fi
  if [[ -n "${DOGFOOD_KWIN_ENVIRON_FILE:-}" ]]; then
    printf '%s\n' "$DOGFOOD_KWIN_ENVIRON_FILE"
    return 0
  fi
  local cmdline_path argv0 base pid
  for cmdline_path in /proc/[0-9]*/cmdline; do
    [[ -e "$cmdline_path" ]] || continue
    argv0="$(tr '\0' '\n' < "$cmdline_path" 2>/dev/null | head -n1)" || continue
    base="${argv0##*/}"
    if [[ "$base" == "kwin_wayland" ]]; then
      pid="${cmdline_path#/proc/}"
      pid="${pid%/cmdline}"
      printf '/proc/%s/environ\n' "$pid"
      return 0
    fi
  done
  return 1
}

cmd_effect_status() {
  require_tool QDBUS_BIN qdbus
  local qdbus="$TOOL"

  # [a] staging
  local a_ok="false"
  if [[ -f "$EFFECT_STAGED_SO" ]]; then
    a_ok="true"
    echo "[a] staging: yes - plugin .so present at $EFFECT_STAGED_SO"
  else
    echo "[a] staging: no - plugin .so not found at $EFFECT_STAGED_SO"
    echo "    -> run 'effect-install' to build and stage it."
  fi
  if [[ -f "$EFFECT_STAGED_KCM" ]]; then
    echo "[a] config module: yes - KCM .so present at $EFFECT_STAGED_KCM"
  else
    a_ok="false"
    echo "[a] config module: no - KCM .so not found at $EFFECT_STAGED_KCM"
    echo "    -> run 'effect-install' to build and stage it."
  fi

  # [b] env script: exists and its content matches what effect-install would
  # write today.
  local b_ok="false" desired current=""
  desired="$(effect_env_file_contents)"
  if [[ -f "$EFFECT_ENV_FILE" ]]; then
    current="$(cat "$EFFECT_ENV_FILE")"
    if [[ "$current" == "${desired%$'\n'}" ]]; then
      b_ok="true"
      echo "[b] env script: yes - $EFFECT_ENV_FILE exists and its content is current"
    else
      echo "[b] env script: stale - $EFFECT_ENV_FILE exists but its content is out of date"
      echo "    -> run 'effect-install' to rewrite it."
    fi
  else
    echo "[b] env script: no - $EFFECT_ENV_FILE not found"
    echo "    -> run 'effect-install' to create it."
  fi

  # [c] session delivery: read the RUNNING kwin_wayland process's own
  # QT_PLUGIN_PATH directly from /proc rather than inferring it, so this
  # never silently assumes a session boundary is the explanation.
  local c_state="unknown" c_reason="" environ_file=""
  if environ_file="$(find_kwin_environ_file)"; then
    # Read-and-discard first to detect an unreadable file by exit status
    # alone; the actual extraction below pipes tr/grep directly off the file
    # (never through a bash command-substitution variable) because bash's
    # $(...) silently drops NUL bytes, which would corrupt the NUL-separated
    # /proc/<pid>/environ format before tr ever sees it.
    local cat_ok=1
    cat "$environ_file" >/dev/null 2>&1 || cat_ok=0
    if [[ "$cat_ok" -eq 1 ]]; then
      local environ_qt_plugin_path=""
      environ_qt_plugin_path="$(tr '\0' '\n' < "$environ_file" 2>/dev/null | grep '^QT_PLUGIN_PATH=' || true)"
      if [[ "$environ_qt_plugin_path" == *"$EFFECT_ROOT"* ]]; then
        c_state="true"
        echo "[c] session delivery: yes - the running kwin_wayland process's QT_PLUGIN_PATH includes $EFFECT_ROOT ($environ_file)"
      else
        c_state="false"
        echo "[c] session delivery: no - the running kwin_wayland process's QT_PLUGIN_PATH does not include $EFFECT_ROOT ($environ_file)"
      fi
    else
      c_reason="$environ_file is not readable (permission denied)"
    fi
  else
    c_reason="the running kwin_wayland process could not be found"
  fi
  if [[ "$c_state" == "unknown" ]]; then
    echo "[c] session delivery: could not determine - $c_reason"
    echo "    -> this stage is inconclusive; do not assume either outcome. Verify manually if needed."
  elif [[ "$c_state" == "false" ]]; then
    if [[ "$b_ok" == "true" ]]; then
      echo "    -> the env script is current but has not reached the running KWin session: a logout/login is still pending, or the env-script route did not work. Log out and back in, then re-run 'effect-status'; if it still fails after that, report this as a bug."
    else
      echo "    -> stage b (env script) is not correct yet; fix that first (see above), then log out and back in."
    fi
  fi

  # [d] discovery
  local supported="" discovery_state="error"
  if supported="$( "$qdbus" org.kde.KWin /Effects org.kde.kwin.Effects.isEffectSupported "$EFFECT_PLUGIN_ID" 2>/dev/null )"; then
    case "$supported" in
      true)
        discovery_state="true"
        echo "[d] discovery: yes - isEffectSupported reports true for $EFFECT_PLUGIN_ID"
        ;;
      false)
        discovery_state="false"
        echo "[d] discovery: no - isEffectSupported reports false for $EFFECT_PLUGIN_ID"
        if [[ "$c_state" == "true" ]]; then
          echo "    -> QT_PLUGIN_PATH reached the running KWin session (stage c passed) but the plugin still was not loadable. This is not a session-boundary problem: check 'journalctl --user -b' (or the system journal) for KWin plugin-loading errors around $EFFECT_PLUGIN_ID, and re-run 'effect-install' to rule out a stale build."
        elif [[ "$c_state" == "false" ]]; then
          echo "    -> stage c (session delivery) already failed; fix that first (see above) before expecting this to change."
        else
          echo "    -> stage c could not be determined; investigate session delivery manually (see above) before assuming this is a plugin-loading problem."
        fi
        ;;
      *)
        discovery_state="invalid"
        echo "[d] discovery: error - qdbus returned an invalid isEffectSupported reply for $EFFECT_PLUGIN_ID: ${supported:-<empty>}"
        echo "    -> the discovery query is inconclusive; do not infer a session boundary or a plugin-loading failure from it."
        ;;
    esac
  else
    echo "[d] discovery: error - qdbus failed to query isEffectSupported for $EFFECT_PLUGIN_ID"
    echo "    -> the discovery query is inconclusive; do not infer a session boundary or a plugin-loading failure from it."
  fi

  # [e] loaded
  local loaded=""
  if loaded="$( "$qdbus" org.kde.KWin /Effects org.kde.kwin.Effects.isEffectLoaded "$EFFECT_PLUGIN_ID" 2>/dev/null )"; then
    case "$loaded" in
      true)
        echo "[e] loaded: yes - isEffectLoaded reports true for $EFFECT_PLUGIN_ID"
        ;;
      false)
        echo "[e] loaded: no - isEffectLoaded reports false for $EFFECT_PLUGIN_ID"
        if [[ "$discovery_state" == "true" ]]; then
          echo "    -> effect is supported but not currently loaded; run 'effect-reload' to load it."
        elif [[ "$discovery_state" == "false" ]]; then
          echo "    -> stage d (discovery) already failed; loading cannot succeed until discovery passes."
        else
          echo "    -> stage d (discovery) did not produce a usable result; loading cannot be assessed."
        fi
        ;;
      *)
        echo "[e] loaded: error - qdbus returned an invalid isEffectLoaded reply for $EFFECT_PLUGIN_ID: ${loaded:-<empty>}"
        echo "    -> the loaded-state query is inconclusive; do not infer that the effect is unloaded."
        ;;
    esac
  else
    echo "[e] loaded: error - qdbus failed to query isEffectLoaded for $EFFECT_PLUGIN_ID"
    echo "    -> the loaded-state query is inconclusive; do not infer that the effect is unloaded."
  fi
  return 0
}

cmd_effect_remove() {
  require_tool KREADCONFIG6_BIN kreadconfig6
  local kreadconfig="$TOOL"
  local missing_key_marker="__plasma_auto_tiler_key_absent__"
  local current_key_value
  current_key_value="$( "$kreadconfig" --file "$KWINRC" --group Plugins --key "$EFFECT_CONFIG_KEY" --default "$missing_key_marker" )" || {
    echo "error: kreadconfig6 failed to read $EFFECT_CONFIG_KEY from $KWINRC" >&2
    exit 1
  }
  local key_present=1
  if [[ "$current_key_value" == "$missing_key_marker" ]]; then
    key_present=0
  fi
  local has_root=0 has_env=0 has_legacy=0
  [[ -e "$EFFECT_ROOT" || -L "$EFFECT_ROOT" ]] && has_root=1
  [[ -e "$EFFECT_ENV_FILE" || -L "$EFFECT_ENV_FILE" ]] && has_env=1
  [[ -e "$LEGACY_EFFECT_ENV_FILE" || -L "$LEGACY_EFFECT_ENV_FILE" ]] && has_legacy=1
  if [[ "$has_root" -eq 0 && "$has_env" -eq 0 && "$has_legacy" -eq 0 && "$key_present" -eq 0 ]]; then
    echo "effect-remove: nothing to do ($EFFECT_ROOT, $EFFECT_ENV_FILE, and $LEGACY_EFFECT_ENV_FILE not present)"
    return 0
  fi

  for path in "$EFFECT_ROOT" "$EFFECT_ENV_FILE" "$LEGACY_EFFECT_ENV_FILE"; do
    if [[ -L "$path" ]]; then
      echo "error: refusing to remove symlinked project state: $path" >&2
      exit 1
    fi
  done
  if [[ "$has_root" -eq 1 && ! -d "$EFFECT_ROOT" ]]; then
    echo "error: refusing to remove non-directory native-effect root: $EFFECT_ROOT" >&2
    exit 1
  fi
  if [[ "$has_env" -eq 1 && ! -f "$EFFECT_ENV_FILE" ]]; then
    echo "error: refusing to remove non-regular environment script: $EFFECT_ENV_FILE" >&2
    exit 1
  fi
  if [[ "$has_legacy" -eq 1 && ! -f "$LEGACY_EFFECT_ENV_FILE" ]]; then
    echo "error: refusing to remove non-regular legacy environment entry: $LEGACY_EFFECT_ENV_FILE" >&2
    exit 1
  fi

  require_tool QDBUS_BIN qdbus
  local qdbus="$TOOL"
  local loaded
  loaded="$("$qdbus" org.kde.KWin /Effects org.kde.kwin.Effects.isEffectLoaded "$EFFECT_PLUGIN_ID")" || {
    echo "error: qdbus failed to determine whether $EFFECT_PLUGIN_ID is loaded; refusing effect removal" >&2
    exit 1
  }
  if [[ "$loaded" == "true" ]]; then
    echo "error: $EFFECT_PLUGIN_ID is currently loaded; refusing to delete its files. Unload it through a documented KWin mechanism or end the session, then rerun effect-remove. Staged files, env script, and kwinrc are unchanged." >&2
    exit 1
  fi
  if [[ "$loaded" != "false" ]]; then
    echo "error: qdbus returned an invalid isEffectLoaded reply for $EFFECT_PLUGIN_ID: ${loaded:-<empty>}; refusing effect removal" >&2
    exit 1
  fi

  mkdir -p "$DATA_ROOT" || {
    echo "error: could not create data root: $DATA_ROOT" >&2
    exit 1
  }
  local remove_transaction
  remove_transaction="$(mktemp -d "$DATA_ROOT/.plasma-auto-tiler-native-effect-remove.XXXXXX")" || {
    echo "error: could not create native-effect removal transaction directory" >&2
    exit 1
  }
  local remove_config_backup="$remove_transaction/previous-kwinrc"
  local remove_config_had_file=0 remove_config_snapshot=0
  local remove_root_moved=0 remove_env_moved=0 remove_legacy_moved=0
  local remove_cleanup_done=0 remove_pending_signal=""

  effect_remove_signal() {
    remove_pending_signal="$1"
  }
  effect_remove_check_signal() {
    local signal="${remove_pending_signal:-}"
    [[ -z "$signal" ]] || {
      remove_pending_signal=""
      case "$signal" in
        INT) effect_remove_abort "interrupted by SIGINT" 130 ;;
        TERM) effect_remove_abort "interrupted by SIGTERM" 143 ;;
        HUP) effect_remove_abort "interrupted by SIGHUP" 129 ;;
      esac
    }
  }
  effect_remove_rollback() {
    [[ "$remove_cleanup_done" -eq 0 ]] || return 0
    remove_cleanup_done=1
    local ok=0
    [[ "$remove_root_moved" -eq 0 ]] || mv -- "$remove_transaction/root" "$EFFECT_ROOT" || ok=1
    [[ "$remove_env_moved" -eq 0 ]] || mv -- "$remove_transaction/env" "$EFFECT_ENV_FILE" || ok=1
    [[ "$remove_legacy_moved" -eq 0 ]] || mv -- "$remove_transaction/legacy" "$LEGACY_EFFECT_ENV_FILE" || ok=1
    if [[ "$remove_config_snapshot" -eq 1 ]]; then
      if [[ "$remove_config_had_file" -eq 1 ]]; then
        cp -p -- "$remove_config_backup" "$KWINRC" || ok=1
      else
        rm -f -- "$KWINRC" || ok=1
      fi
    fi
    rm -rf -- "$remove_transaction" || ok=1
    return "$ok"
  }
  effect_remove_cleanup() {
    local status=$?
    trap - EXIT INT TERM HUP
    if [[ "$remove_cleanup_done" -eq 0 ]]; then
      trap '' INT TERM HUP
      local rollback_status=0
      effect_remove_rollback || rollback_status=$?
      trap - INT TERM HUP
      if [[ "$rollback_status" -ne 0 ]]; then
        echo "error: interrupted or failed native-effect removal; rollback failed - inspect the native-effect staging and kwinrc state" >&2
      fi
    fi
    return "$status"
  }
  effect_remove_abort() {
    local message="$1"
    local status="${2:-1}"
    trap - EXIT INT TERM HUP
    trap '' INT TERM HUP
    local rollback_status=0
    effect_remove_rollback || rollback_status=$?
    trap - INT TERM HUP
    if [[ "$rollback_status" -ne 0 ]]; then
      echo "error: $message; rollback failed - inspect the native-effect staging and kwinrc state" >&2
    else
      echo "error: $message" >&2
    fi
    exit "$status"
  }

  trap 'effect_remove_signal INT' INT
  trap 'effect_remove_signal TERM' TERM
  trap 'effect_remove_signal HUP' HUP
  trap 'effect_remove_cleanup' EXIT

  if [[ "$key_present" -eq 1 ]]; then
    require_tool KWRITECONFIG6_BIN kwriteconfig6
    local kwriteconfig="$TOOL"
    if [[ -L "$KWINRC" || ( -e "$KWINRC" && ! -f "$KWINRC" ) ]]; then
      effect_remove_abort "kwinrc is not a regular file: $KWINRC"
    fi
    if [[ -f "$KWINRC" ]]; then
      if ! cp -p -- "$KWINRC" "$remove_config_backup"; then
        effect_remove_abort "could not snapshot kwinrc: $KWINRC"
      fi
      remove_config_had_file=1
    fi
    remove_config_snapshot=1
    effect_remove_check_signal
  fi

  if [[ "$has_root" -eq 1 ]]; then
    mv -- "$EFFECT_ROOT" "$remove_transaction/root" || effect_remove_abort "could not stage native-effect root for removal"
    remove_root_moved=1
    effect_remove_check_signal
  fi
  if [[ "$has_env" -eq 1 ]]; then
    mv -- "$EFFECT_ENV_FILE" "$remove_transaction/env" || effect_remove_abort "could not stage native-effect environment script for removal"
    remove_env_moved=1
    effect_remove_check_signal
  fi
  if [[ "$has_legacy" -eq 1 ]]; then
    mv -- "$LEGACY_EFFECT_ENV_FILE" "$remove_transaction/legacy" || effect_remove_abort "could not stage legacy environment entry for removal"
    remove_legacy_moved=1
    effect_remove_check_signal
  fi

  if [[ "$key_present" -eq 1 ]]; then
    if ! "$kwriteconfig" --file "$KWINRC" --group Plugins --key "$EFFECT_CONFIG_KEY" --delete; then
      effect_remove_abort "kwriteconfig6 failed to delete $EFFECT_CONFIG_KEY from $KWINRC"
    fi
    effect_remove_check_signal
  fi

  effect_remove_check_signal
  [[ "$has_root" -eq 0 ]] || echo "removed: $EFFECT_ROOT"
  [[ "$has_env" -eq 0 ]] || echo "removed: $EFFECT_ENV_FILE"
  [[ "$has_legacy" -eq 0 ]] || echo "removed (legacy): $LEGACY_EFFECT_ENV_FILE"
  [[ "$key_present" -eq 0 ]] || echo "removed (kwinrc key): $EFFECT_CONFIG_KEY"
  trap - EXIT INT TERM HUP
  rm -rf -- "$remove_transaction"
  remove_transaction=""
}

cmd_setup() {
  echo "==> [1/4] install"
  cmd_install

  echo "==> [2/4] enable"
  cmd_enable

  echo "==> [3/4] effect-install"
  local effect_install_ok=true
  if ( cmd_effect_install ); then
    :
  else
    effect_install_ok=false
    echo "effect-install: skipped (native-effect build tool unavailable or build failed); the KWin-script half above still completed; run 'devenv shell --impure -- bash scripts/dogfood-install.sh effect-install' manually later"
  fi

  echo "==> [4/4] effect-reload"
  local effect_reload_ok=true
  if [[ "$effect_install_ok" == true ]]; then
    if ( cmd_effect_reload ); then
      :
    else
      effect_reload_ok=false
    fi
  else
    effect_reload_ok=false
    echo "effect-reload: skipped (effect-install did not succeed)"
  fi

  echo "==> setup summary"
  echo "install: ok"
  echo "enable: ok"
  if [[ "$effect_install_ok" == true ]]; then
    echo "effect-install: ok"
  else
    echo "effect-install: skipped"
  fi
  if [[ "$effect_install_ok" == true && "$effect_reload_ok" == true ]]; then
    echo "effect-reload: ok"
  elif [[ "$effect_install_ok" == true ]]; then
    echo "effect-reload: failed"
  else
    echo "effect-reload: skipped"
  fi

  echo "what remains manual:"
  if [[ "$effect_install_ok" != true ]]; then
    echo "  - the native-effect build did not run; once inside 'devenv shell --impure', rerun 'effect-install' (or 'setup') manually"
  elif [[ "$effect_reload_ok" != true ]]; then
    echo "  - effect-reload failed for a non-boundary reason; resolve the reported error, then run 'effect-reload' (or 'setup') again"
  else
    echo "  - none: $EFFECT_CONFIG_KEY is set to true in $KWINRC, so the effect stays enabled and auto-loads on future reboots and logins without re-running 'effect-reload'"
  fi

  return 0
}

if [[ $# -eq 0 ]]; then
  echo "error: missing command (install, uninstall, enable, disable, reload, status, or dry-run)" >&2
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
  reload)
    if [[ $# -ne 1 ]]; then
      echo "error: 'reload' takes no arguments" >&2
      exit 1
    fi
    cmd_reload
    ;;
  status)
    if [[ $# -ne 1 ]]; then
      echo "error: 'status' takes no arguments" >&2
      exit 1
    fi
    cmd_status
    ;;
  dry-run)
    if [[ $# -ne 1 ]]; then
      echo "error: 'dry-run' takes no arguments" >&2
      exit 1
    fi
    cmd_dry_run
    ;;
  effect-install)
    if [[ $# -ne 1 ]]; then
      echo "error: 'effect-install' takes no arguments" >&2
      exit 1
    fi
    cmd_effect_install
    ;;
  effect-reload)
    if [[ $# -ne 1 ]]; then
      echo "error: 'effect-reload' takes no arguments" >&2
      exit 1
    fi
    cmd_effect_reload
    ;;
  effect-status)
    if [[ $# -ne 1 ]]; then
      echo "error: 'effect-status' takes no arguments" >&2
      exit 1
    fi
    cmd_effect_status
    ;;
  effect-remove)
    if [[ $# -ne 1 ]]; then
      echo "error: 'effect-remove' takes no arguments" >&2
      exit 1
    fi
    cmd_effect_remove
    ;;
  setup)
    if [[ $# -ne 1 ]]; then
      echo "error: 'setup' takes no arguments" >&2
      exit 1
    fi
    cmd_setup
    ;;
  *)
    echo "error: unknown command '$1'" >&2
    usage >&2
    exit 1
    ;;
esac
