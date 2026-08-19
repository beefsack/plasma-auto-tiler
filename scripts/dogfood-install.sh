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
KWIN_DEV_CMAKE_DIR="/nix/store/483vmk08g6bjaa3bvf3abn10cwpw6ap9-kwin-6.7.3-dev/lib/cmake/KWin"

# Normal roots derive from XDG paths. Test-only overrides: DOGFOOD_DATA_ROOT and
# DOGFOOD_CONFIG_ROOT point the script at a throwaway tree so shell tests never
# reach real user paths.
DATA_ROOT="${DOGFOOD_DATA_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}}"
CONFIG_ROOT="${DOGFOOD_CONFIG_ROOT:-${XDG_CONFIG_HOME:-$HOME/.config}}"
INSTALL_DIR="$DATA_ROOT/kwin/scripts/$PLUGIN_ID"
KWINRC="$CONFIG_ROOT/kwinrc"

EFFECT_ROOT="$DATA_ROOT/plasma-auto-tiler-native-effect"
EFFECT_BUILD_DIR="$EFFECT_ROOT/build"
EFFECT_SOURCE_DIR="$REPO_ROOT/kwin/native-effect"
EFFECT_STAGED_SO="$EFFECT_ROOT/kwin/effects/plugins/$EFFECT_PLUGIN_ID.so"

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
  dry-run    inspect source package metadata, bundle, KCM schema/UI, and
             destination install/enabled state; lists intended install
             actions; read-only, never mutates

  effect-install  build the native "active border" effect plugin and stage
                  it under
                  $XDG_DATA_HOME/plasma-auto-tiler-native-effect/kwin/effects/plugins/
                  (or the $HOME/.local/share equivalent when XDG_DATA_HOME is
                  unset); writes a QT_PLUGIN_PATH env script under
                  $XDG_CONFIG_HOME/plasma-workspace/env/ so the staged plugin
                  dir is discovered on next login; also writes
                  [Plugins] plasma-auto-tiler-active-borderEnabled=true to
                  kwinrc so the effect persists across future session starts
                  once discovered (does not reconfigure KWin or use D-Bus);
                  idempotent
  effect-reload   query D-Bus for effect support; if supported, unload and
                  reload the effect live; if not yet supported (the
                  plasma-workspace env script requires a logout/login to take
                  effect), reports this plainly and exits non-zero without
                  attempting load/unload
  effect-status   staged diagnostic: staging, env script, session delivery
                  (reads the running kwin_wayland process's own environment),
                  D-Bus discovery, and D-Bus loaded state, each reported
                  pass/fail with guidance; read-only, never mutates
  effect-remove   remove the staged effect tree, the plasma-workspace env
                  script, the kwinrc [Plugins]
                  plasma-auto-tiler-active-borderEnabled key when present, and
                  (migration cleanup) any legacy environment.d entry this
                  project wrote previously; idempotent

  setup      one-command install: composes install, enable, effect-install,
             and effect-reload in that order. install/enable are the
             required half and abort setup on real failure. effect-install
             and effect-reload are optional and degrade gracefully: a
             missing build toolchain (e.g. not inside 'devenv shell
             --impure') or the expected first-run "needs a logout/login"
             effect-reload outcome are reported, not treated as failures.
             setup exits 0 whenever install and enable both succeeded, and
             always prints a per-stage summary plus what remains manual.

  --help     show this help and exit

Runtime tool-path overrides: NPM_BIN, KWRITECONFIG6_BIN, KREADCONFIG6_BIN,
QDBUS_BIN, JQ_BIN, CMAKE_BIN.
Test-only destination/config root overrides: DOGFOOD_DATA_ROOT,
DOGFOOD_CONFIG_ROOT. Test-only effect-status session-delivery overrides:
DOGFOOD_KWIN_ENVIRON_FILE (read this path instead of scanning /proc),
DOGFOOD_KWIN_NOT_RUNNING (force the "process not found" branch).

install and uninstall never touch KWin configuration; enable and disable
mutate kwinrc and reconfigure the running KWin session.
effect-install and effect-remove touch kwinrc (only the one [Plugins]
enablement key for the native effect) but never use D-Bus; effect-reload is
the only effect command that mutates the running KWin session via D-Bus;
effect-status is read-only.
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

cmd_effect_install() {
  require_tool CMAKE_BIN cmake
  local cmake="$TOOL"

  if ! "$cmake" -S "$EFFECT_SOURCE_DIR" -B "$EFFECT_BUILD_DIR" -DKWin_DIR="$KWIN_DEV_CMAKE_DIR" -DBUILD_TESTING=OFF; then
    echo "error: cmake configure failed for $EFFECT_SOURCE_DIR" >&2
    exit 1
  fi
  if ! "$cmake" --build "$EFFECT_BUILD_DIR"; then
    echo "error: cmake --build failed for $EFFECT_BUILD_DIR" >&2
    exit 1
  fi

  local built_so="$EFFECT_BUILD_DIR/bin/kwin/effects/plugins/$EFFECT_PLUGIN_ID.so"
  if [[ ! -f "$built_so" ]]; then
    echo "error: bundle not found after build: $built_so" >&2
    exit 1
  fi

  install -Dm0644 "$built_so" "$EFFECT_STAGED_SO"

  local desired
  desired="$(effect_env_file_contents)"
  local current=""
  [[ -f "$EFFECT_ENV_FILE" ]] && current="$(cat "$EFFECT_ENV_FILE")"
  if [[ "$current" != "${desired%$'\n'}" ]]; then
    mkdir -p "$(dirname "$EFFECT_ENV_FILE")"
    printf '%s' "$desired" > "$EFFECT_ENV_FILE"
  fi

  require_tool KWRITECONFIG6_BIN kwriteconfig6
  local kwriteconfig="$TOOL"
  if ! "$kwriteconfig" --file "$KWINRC" --group Plugins --key "$EFFECT_CONFIG_KEY" true; then
    echo "error: kwriteconfig6 failed to set $EFFECT_CONFIG_KEY=true in $KWINRC" >&2
    exit 1
  fi

  echo "staged: $EFFECT_STAGED_SO"
  echo "env script: $EFFECT_ENV_FILE"
  echo "kwinrc: $EFFECT_CONFIG_KEY set to true (persists across future session starts once the effect is discovered by KWin; this does not itself trigger a live D-Bus load - use 'effect-reload' for that)"
  echo "note: a logout/login (or new session) is required before the effect is discovered by KWin."
}

cmd_effect_reload() {
  require_tool QDBUS_BIN qdbus
  local qdbus="$TOOL"

  local supported
  supported="$( "$qdbus" org.kde.KWin /Effects org.kde.kwin.Effects.isEffectSupported "$EFFECT_PLUGIN_ID" )" || {
    echo "error: qdbus failed to query isEffectSupported for $EFFECT_PLUGIN_ID" >&2
    exit 1
  }
  if [[ "$supported" != "true" ]]; then
    echo "effect-reload: $EFFECT_PLUGIN_ID is not yet discovered by KWin; the env script at $EFFECT_ENV_FILE requires one logout/login (or new session) to take effect before it can be reloaded live." >&2
    exit 1
  fi

  "$qdbus" org.kde.KWin /Effects org.kde.kwin.Effects.unloadEffect "$EFFECT_PLUGIN_ID" >/dev/null || true
  if ! "$qdbus" org.kde.KWin /Effects org.kde.kwin.Effects.loadEffect "$EFFECT_PLUGIN_ID" >/dev/null; then
    echo "error: qdbus failed to loadEffect $EFFECT_PLUGIN_ID" >&2
    exit 1
  fi

  local loaded
  loaded="$( "$qdbus" org.kde.KWin /Effects org.kde.kwin.Effects.isEffectLoaded "$EFFECT_PLUGIN_ID" )" || {
    echo "error: qdbus failed to query isEffectLoaded for $EFFECT_PLUGIN_ID" >&2
    exit 1
  }
  if [[ "$loaded" != "true" ]]; then
    echo "error: loadEffect did not result in $EFFECT_PLUGIN_ID being loaded" >&2
    exit 1
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
  local supported=""
  supported="$( "$qdbus" org.kde.KWin /Effects org.kde.kwin.Effects.isEffectSupported "$EFFECT_PLUGIN_ID" 2>/dev/null )" || supported=""
  if [[ "$supported" == "true" ]]; then
    echo "[d] discovery: yes - isEffectSupported reports true for $EFFECT_PLUGIN_ID"
  else
    echo "[d] discovery: no - isEffectSupported reports false for $EFFECT_PLUGIN_ID"
    if [[ "$c_state" == "true" ]]; then
      echo "    -> QT_PLUGIN_PATH reached the running KWin session (stage c passed) but the plugin still was not loadable. This is not a session-boundary problem: check 'journalctl --user -b' (or the system journal) for KWin plugin-loading errors around $EFFECT_PLUGIN_ID, and re-run 'effect-install' to rule out a stale build."
    elif [[ "$c_state" == "false" ]]; then
      echo "    -> stage c (session delivery) already failed; fix that first (see above) before expecting this to change."
    else
      echo "    -> stage c could not be determined; investigate session delivery manually (see above) before assuming this is a plugin-loading problem."
    fi
  fi

  # [e] loaded
  local loaded=""
  loaded="$( "$qdbus" org.kde.KWin /Effects org.kde.kwin.Effects.isEffectLoaded "$EFFECT_PLUGIN_ID" 2>/dev/null )" || loaded=""
  if [[ "$loaded" == "true" ]]; then
    echo "[e] loaded: yes - isEffectLoaded reports true for $EFFECT_PLUGIN_ID"
  else
    echo "[e] loaded: no - isEffectLoaded reports false for $EFFECT_PLUGIN_ID"
    if [[ "$supported" == "true" ]]; then
      echo "    -> effect is supported but not currently loaded; run 'effect-reload' to load it."
    else
      echo "    -> stage d (discovery) already failed; loading cannot succeed until discovery passes."
    fi
  fi
  return 0
}

cmd_effect_remove() {
  local removed=0
  if [[ -e "$EFFECT_ROOT" ]]; then
    rm -rf "$EFFECT_ROOT"
    echo "removed: $EFFECT_ROOT"
    removed=1
  fi
  if [[ -e "$EFFECT_ENV_FILE" ]]; then
    rm -f "$EFFECT_ENV_FILE"
    echo "removed: $EFFECT_ENV_FILE"
    removed=1
  fi
  # Migration cleanup: remove only this project's own legacy environment.d
  # entry (superseded by EFFECT_ENV_FILE above), never any other file under
  # environment.d/ (in particular, never 10-home-manager.conf).
  if [[ -e "$LEGACY_EFFECT_ENV_FILE" ]]; then
    rm -f "$LEGACY_EFFECT_ENV_FILE"
    echo "removed (legacy): $LEGACY_EFFECT_ENV_FILE"
    removed=1
  fi
  require_tool KREADCONFIG6_BIN kreadconfig6
  local kreadconfig="$TOOL"
  local current_key_value
  current_key_value="$( "$kreadconfig" --file "$KWINRC" --group Plugins --key "$EFFECT_CONFIG_KEY" )" || {
    echo "error: kreadconfig6 failed to read $EFFECT_CONFIG_KEY from $KWINRC" >&2
    exit 1
  }
  if [[ -n "$current_key_value" ]]; then
    require_tool KWRITECONFIG6_BIN kwriteconfig6
    local kwriteconfig="$TOOL"
    if ! "$kwriteconfig" --file "$KWINRC" --group Plugins --key "$EFFECT_CONFIG_KEY" --delete; then
      echo "error: kwriteconfig6 failed to delete $EFFECT_CONFIG_KEY from $KWINRC" >&2
      exit 1
    fi
    echo "removed (kwinrc key): $EFFECT_CONFIG_KEY"
    removed=1
  fi
  if [[ "$removed" -eq 0 ]]; then
    echo "effect-remove: nothing to do ($EFFECT_ROOT, $EFFECT_ENV_FILE, and $LEGACY_EFFECT_ENV_FILE not present)"
  fi
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
    echo "effect-reload: pending-boundary"
  else
    echo "effect-reload: skipped"
  fi

  echo "what remains manual:"
  if [[ "$effect_install_ok" != true ]]; then
    echo "  - the native-effect build did not run; once inside 'devenv shell --impure', rerun 'effect-install' (or 'setup') manually"
  elif [[ "$effect_reload_ok" != true ]]; then
    echo "  - effect-reload is pending the expected first-run logout/login boundary; log out and back in once, then run 'effect-reload' (or 'setup') again"
  else
    echo "  - the effect is loaded for this session only; it does not survive a reboot or logout/login (EnabledByDefault is false, nothing auto-loads it); after every future reboot or logout/login, re-run 'effect-reload' (or 'setup') again"
  fi

  return 0
}

if [[ $# -eq 0 ]]; then
  echo "error: missing command (install, uninstall, enable, disable, status, or dry-run)" >&2
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
