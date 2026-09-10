# Development loop for the worktree Planner and KWin script.
#
# Run from inside the devenv shell as `just <recipe>`. Only the build step
# needs the devenv environment; every other step uses host Plasma tools
# directly. Never resolves the Planner through /nix/store and never creates
# a `result` symlink. All preconditions fail closed loudly.
#
# State pointers, never the receipt itself:
#   $XDG_RUNTIME_DIR/plasma-auto-tiler-dev/planner-pid
#   $XDG_RUNTIME_DIR/plasma-auto-tiler-dev/planner-exe
#   $XDG_RUNTIME_DIR/plasma-auto-tiler-dev/controller-receipt-path
# The controller receipt itself is a per-run file under $XDG_RUNTIME_DIR
# (plasma-auto-tiler-controller.XXXXXX/ownership), derived dynamically via
# mktemp and threaded to start-test.sh through CONTROLLER_OWNERSHIP_FILE.

set shell := ["bash", "-euo", "pipefail", "-c"]

plugin_id := "plasma-auto-tiler-kwin"
planner_bus_name := "org.plasmaautotiler.Planner"
planner_unit := "plasma-auto-tiler-planner.service"

default:
    @just --list

# Disable packaged script, verify unloaded, require Planner name unowned,
# build, launch worktree Planner detached, load worktree KWin bundle.
dev-on:
    #!/usr/bin/env bash
    set -euo pipefail
    REPO_ROOT="{{ justfile_directory() }}"
    PLUGIN_ID="plasma-auto-tiler-kwin"
    PLANNER_BUS="org.plasmaautotiler.Planner"
    BIN="$REPO_ROOT/target/debug/plasma-auto-tiler"
    RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}"
    STATE_DIR="$RUNTIME_DIR/plasma-auto-tiler-dev"
    PID_FILE="$STATE_DIR/planner-pid"
    EXE_FILE="$STATE_DIR/planner-exe"
    START_FILE="$STATE_DIR/planner-start"
    RECEIPT_PTR="$STATE_DIR/controller-receipt-path"
    planner_start_identity() {
      local pid="$1" stat_line stat_pid rest
      local -a fields=()
      stat_line="$(<"/proc/$pid/stat")" || return 1
      [[ "$stat_line" != *$'\n'* ]] || return 1
      stat_pid="${stat_line%% *}"
      [[ "$stat_pid" == "$pid" ]] || return 1
      rest="${stat_line##*) }"
      [[ "$rest" != "$stat_line" ]] || return 1
      read -r -a fields <<<"$rest"
      [[ "${#fields[@]}" -ge 20 && "${fields[0]:-}" =~ ^[A-Za-z]$ ]] || return 1
      [[ "${fields[19]:-}" =~ ^[1-9][0-9]*$ ]] || return 1
      printf '%s\n' "${fields[19]}"
    }
    planner_exe_is_worktree() {
      local raw="$1" normalized="$1"
      [[ -n "$raw" ]] || return 1
      case "$BIN" in *" (deleted)") return 1 ;; esac
      case "$normalized" in *" (deleted)") normalized="${normalized%' (deleted)'}"; ;; esac
      case "$normalized" in */nix/store/*) return 1 ;; esac
      [[ "$normalized" == "$BIN" ]] || return 1
    }
    case "$BIN" in *" (deleted)") echo "error: configured worktree binary path is ambiguous ('$BIN'); refusing" >&2; exit 1 ;; esac
    planner_verify_worktree() {
      local pid="$1" exe candidate_start
      [[ "$pid" =~ ^[0-9]+$ ]] || return 1
      [[ -d "/proc/$pid" ]] || return 1
      exe="$(readlink "/proc/$pid/exe" 2>/dev/null || true)"
      planner_exe_is_worktree "$exe" || return 1
      tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -Fq "planner-service" || return 1
      candidate_start="$(planner_start_identity "$pid")" || return 1
      [[ "$candidate_start" =~ ^[1-9][0-9]*$ ]] || return 1
      printf '%s\n' "$candidate_start"
    }
    planner_dbus_owner_pid() {
      local owner_reply owner_name owner_pid
      owner_reply="$(busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s "$PLANNER_BUS" 2>/dev/null)" || return 1
      owner_name="$(echo "$owner_reply" | awk '{print $NF}' | tr -d '\"')"
      [[ -n "$owner_name" ]] || return 1
      owner_pid="$(busctl --user --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetConnectionUnixProcessID s "$owner_name" 2>/dev/null | jq -r '.data[0] // empty' 2>/dev/null || true)"
      [[ "$owner_pid" =~ ^[0-9]+$ ]] || return 1
      printf '%s\n' "$owner_pid"
    }
    controller_loaded_word() {
      local out
      out="$(busctl --user --json=short call org.kde.KWin /Scripting org.kde.kwin.Scripting isScriptLoaded s "$PLUGIN_ID" 2>/dev/null)" || { echo "error: isScriptLoaded call failed" >&2; return 1; }
      if ! echo "$out" | jq -e '((keys | sort) == ["data","type"]) and (.type == "b") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "boolean")' >/dev/null 2>&1; then
        echo "error: unexpected isScriptLoaded reply: $out" >&2
        return 1
      fi
      if [[ "$(echo "$out" | jq -r '.data[0]')" == "true" ]]; then printf 'loaded\n'; else printf 'not-loaded\n'; fi
    }
    planner_probe_verified() {
      local owner_pid cand_start
      owner_pid="$(planner_dbus_owner_pid 2>/dev/null)" || return 1
      cand_start="$(planner_verify_worktree "$owner_pid" 2>/dev/null)" || return 1
      printf '%s %s\n' "$owner_pid" "$cand_start"
    }
    ROLLBACK_ARMED=0
    RECOVERY_ARMED=0
    ROLLBACK_RECEIPT_DIR=""
    VERIFIED_PID=""
    VERIFIED_EXE=""
    VERIFIED_START=""
    LOADED_OK=0
    RECEIPT=""
    RECEIPT_DIR=""
    SCRIPT_ID=""
    dev_on_rollback() {
      local orig_rc="${1:-1}"
      set +e
      if [[ "$LOADED_OK" -eq 1 ]]; then
        if [[ "$SCRIPT_ID" =~ ^[0-9]+$ && "$SCRIPT_ID" -le 2147483647 && -n "$RECEIPT" && -f "$RECEIPT" && ! -L "$RECEIPT" ]]; then
          CONTROLLER_OWNERSHIP_FILE="$RECEIPT" bash "$REPO_ROOT/scripts/start-test.sh" stop "$SCRIPT_ID" >/dev/null 2>&1 || echo "error: rollback: start-test.sh stop $SCRIPT_ID failed; worktree script may still be loaded (receipt $RECEIPT)" >&2
        else
          echo "error: rollback: worktree script was loaded but script ID/receipt is not valid for exact unload (script_id '${SCRIPT_ID:-unknown}', receipt '${RECEIPT:-unknown}'); manual cleanup may be required" >&2
        fi
      fi
      if [[ -n "$VERIFIED_PID" ]]; then
        REVERIFY_START=""
        REVERIFY_START="$(planner_verify_worktree "$VERIFIED_PID" 2>/dev/null || true)"
        if [[ -n "$REVERIFY_START" && "$REVERIFY_START" == "$VERIFIED_START" ]]; then
          kill "$VERIFIED_PID" 2>/dev/null || echo "error: rollback: could not terminate verified worktree planner pid $VERIFIED_PID" >&2
        else
          echo "error: rollback: verified planner identity changed for pid $VERIFIED_PID; refusing to kill ambiguously" >&2
        fi
      fi
      bash "$REPO_ROOT/scripts/dogfood-install.sh" enable >/dev/null 2>&1 || echo "error: rollback: dogfood-install.sh enable failed; packaged script may still be disabled" >&2
      if [[ -n "$ROLLBACK_RECEIPT_DIR" ]]; then
        case "$ROLLBACK_RECEIPT_DIR" in
          "$RUNTIME_DIR"/plasma-auto-tiler-controller.*)
            rm -rf -- "$ROLLBACK_RECEIPT_DIR" 2>/dev/null || echo "error: rollback: could not remove own receipt dir $ROLLBACK_RECEIPT_DIR" >&2
            ;;
          *) echo "error: rollback: refusing to remove unexpected receipt dir $ROLLBACK_RECEIPT_DIR" >&2 ;;
        esac
      fi
      rm -f -- "$PID_FILE" "$EXE_FILE" "$START_FILE" "$RECEIPT_PTR" "$STATE_DIR/planner-log" 2>/dev/null || echo "error: rollback: could not remove dev state files in $STATE_DIR" >&2
      rmdir -- "$STATE_DIR" 2>/dev/null || true
      return "$orig_rc"
    }
    trap 'trap_rc=$?; if [[ "${ROLLBACK_ARMED:-0}" -eq 1 ]]; then dev_on_rollback "$trap_rc"; trap_rc=$?; fi; if [[ "${RECOVERY_ARMED:-0}" -eq 1 ]]; then dev_on_recovery_rollback "$trap_rc"; trap_rc=$?; fi; exit "$trap_rc"' EXIT
    # Classify health from two independently measured facts before any mutation:
    # a verified worktree Planner owning the D-Bus name, and strictly parsed
    # KWin isScriptLoaded. Malformed/transport failures fail closed here.
    PROBE_OUT=""
    SPLIT_PLANNER_PID=""
    SPLIT_PLANNER_START=""
    PLAN_UP=0
    if PROBE_OUT="$(planner_probe_verified 2>/dev/null)"; then
      PLAN_UP=1
      SPLIT_PLANNER_PID="${PROBE_OUT%% *}"
      SPLIT_PLANNER_START="${PROBE_OUT##* }"
    fi
    CTRL_WORD="$(controller_loaded_word)" || exit 1
    CTRL_UP=0
    [[ "$CTRL_WORD" == "loaded" ]] && CTRL_UP=1
    if [[ "$PLAN_UP" -eq 1 && "$CTRL_UP" -eq 1 ]]; then
      echo "dev-on: dev mode already up (planner pid $SPLIT_PLANNER_PID owns $PLANNER_BUS, controller '$PLUGIN_ID' loaded); making no changes"
      if [[ -f "$RECEIPT_PTR" ]] && command -v jq >/dev/null 2>&1; then
        REC_PRINT="$(cat "$RECEIPT_PTR" 2>/dev/null || true)"
        if [[ -f "$REC_PRINT" && ! -L "$REC_PRINT" ]]; then
          SID="$(jq -r '.script_id // empty' "$REC_PRINT" 2>/dev/null || true)"
          [[ -n "$SID" ]] && echo "planner pid: $SPLIT_PLANNER_PID, script id: $SID"
        fi
      fi
      exit 0
    fi
    if [[ "$PLAN_UP" -eq 0 && "$CTRL_UP" -eq 1 ]]; then
      echo "error: controller '$PLUGIN_ID' is loaded but no verified worktree Planner owns $PLANNER_BUS; refusing to start a duplicate (unload the controller or restore the Planner, then re-run)" >&2
      exit 1
    fi
    if [[ "$PLAN_UP" -eq 1 && "$CTRL_UP" -eq 0 ]]; then
      echo "dev-on: verified planner pid $SPLIT_PLANNER_PID owns $PLANNER_BUS but controller '$PLUGIN_ID' is not loaded; recovering exactly one controller without touching the Planner"
      [[ -x "$BIN" ]] || { echo "error: worktree Planner binary missing: $BIN; refusing recovery" >&2; exit 1; }
      if [[ -e "$REPO_ROOT/result" ]]; then
        echo "error: refusing to proceed with a 'result' symlink present at $REPO_ROOT/result" >&2
        exit 1
      fi
      RECOVERY_ARMED=1
      RECOVERY_RECEIPT_DIR=""
      RECOVERY_RECEIPT=""
      RECOVERY_SCRIPT_ID=""
      RECOVERY_LOADED_OK=0
      dev_on_recovery_rollback() {
        local orig_rc="${1:-1}"
        set +e
        if [[ "$RECOVERY_LOADED_OK" -eq 1 ]]; then
          if [[ "$RECOVERY_SCRIPT_ID" =~ ^[0-9]+$ && "$RECOVERY_SCRIPT_ID" -le 2147483647 && -n "$RECOVERY_RECEIPT" && -f "$RECOVERY_RECEIPT" && ! -L "$RECOVERY_RECEIPT" ]]; then
            CONTROLLER_OWNERSHIP_FILE="$RECOVERY_RECEIPT" bash "$REPO_ROOT/scripts/start-test.sh" stop "$RECOVERY_SCRIPT_ID" >/dev/null 2>&1 || echo "error: recovery rollback: start-test.sh stop $RECOVERY_SCRIPT_ID failed; worktree script may still be loaded (receipt $RECOVERY_RECEIPT)" >&2
          else
            echo "error: recovery rollback: worktree script was loaded but script ID/receipt is not valid for exact unload (script_id '${RECOVERY_SCRIPT_ID:-unknown}', receipt '${RECOVERY_RECEIPT:-unknown}'); manual cleanup may be required" >&2
          fi
        fi
        if [[ -n "$RECOVERY_RECEIPT_DIR" ]]; then
          case "$RECOVERY_RECEIPT_DIR" in
            "$RUNTIME_DIR"/plasma-auto-tiler-controller.*)
              rm -rf -- "$RECOVERY_RECEIPT_DIR" 2>/dev/null || echo "error: recovery rollback: could not remove own receipt dir $RECOVERY_RECEIPT_DIR" >&2
              ;;
            *) echo "error: recovery rollback: refusing to remove unexpected receipt dir $RECOVERY_RECEIPT_DIR" >&2 ;;
          esac
        fi
        return "$orig_rc"
      }
      RECOVERY_RECEIPT_DIR="$(mktemp -d "$RUNTIME_DIR/plasma-auto-tiler-controller.XXXXXX")" || { echo "error: could not create controller receipt dir" >&2; exit 1; }
      chmod 700 "$RECOVERY_RECEIPT_DIR" || { rmdir -- "$RECOVERY_RECEIPT_DIR"; echo "error: could not secure controller receipt dir" >&2; exit 1; }
      RECOVERY_RECEIPT="$RECOVERY_RECEIPT_DIR/ownership"
      if [[ -e "$RECOVERY_RECEIPT" || -L "$RECOVERY_RECEIPT" ]]; then
        echo "error: controller receipt path already exists: $RECOVERY_RECEIPT" >&2
        exit 1
      fi
      CONTROLLER_OWNERSHIP_FILE="$RECOVERY_RECEIPT" bash "$REPO_ROOT/scripts/start-test.sh" start || {
        echo "error: start-test.sh start failed during recovery (verified planner $SPLIT_PLANNER_PID left running); no Planner was terminated and packaged script was not re-enabled" >&2
        exit 1
      }
      RECOVERY_LOADED_OK=1
      RECOVERY_SCRIPT_ID="$(jq -r '.script_id // empty' "$RECOVERY_RECEIPT" 2>/dev/null || true)"
      if [[ ! "$RECOVERY_SCRIPT_ID" =~ ^[0-9]+$ ]] || [[ "$RECOVERY_SCRIPT_ID" -gt 2147483647 ]]; then
        echo "error: controller receipt has no valid script_id: $RECOVERY_RECEIPT" >&2
        exit 1
      fi
      RECOVERY_OWNER=""
      RECOVERY_OWNER="$(planner_dbus_owner_pid 2>/dev/null || true)"
      if [[ -z "$RECOVERY_OWNER" || "$RECOVERY_OWNER" != "$SPLIT_PLANNER_PID" ]]; then
        echo "error: Planner D-Bus owner changed during recovery (expected $SPLIT_PLANNER_PID, got '${RECOVERY_OWNER:-unowned}'); refusing to record ambiguous state" >&2
        exit 1
      fi
      RECOVERY_START=""
      RECOVERY_START="$(planner_verify_worktree "$SPLIT_PLANNER_PID" 2>/dev/null || true)"
      if [[ -z "$RECOVERY_START" || "$RECOVERY_START" != "$SPLIT_PLANNER_START" ]]; then
        echo "error: pre-existing Planner identity changed during recovery for pid $SPLIT_PLANNER_PID; refusing to record ambiguous state" >&2
        exit 1
      fi
      mkdir -p "$STATE_DIR" && chmod 700 "$STATE_DIR" || { echo "error: could not create state dir $STATE_DIR" >&2; exit 1; }
      printf '%s\n' "$SPLIT_PLANNER_PID" > "$STATE_DIR/planner-pid" || { echo "error: could not record planner pid" >&2; exit 1; }
      printf '%s\n' "$BIN" > "$STATE_DIR/planner-exe" || { echo "error: could not record planner exe" >&2; exit 1; }
      printf '%s\n' "$SPLIT_PLANNER_START" > "$STATE_DIR/planner-start" || { echo "error: could not record planner start identity" >&2; exit 1; }
      printf '%s\n' "$RECOVERY_RECEIPT" > "$STATE_DIR/controller-receipt-path" || { echo "error: could not record controller receipt path" >&2; exit 1; }
      RECOVERY_ARMED=0
      trap - EXIT
      echo "dev-on: recovered controller script $RECOVERY_SCRIPT_ID against existing planner pid $SPLIT_PLANNER_PID"
      echo "receipt: $RECOVERY_RECEIPT"
      exit 0
    fi
    # Both down: follow the existing normal bring-up below.
    # 1. Disable the packaged KWin script (host tools, no devenv wrapper).
    bash "$REPO_ROOT/scripts/dogfood-install.sh" disable
    ROLLBACK_ARMED=1
    # 2. Verify isScriptLoaded is false; reconfiguration settles asynchronously.
    IS_LOADED_OUT="$(busctl --user --json=short call org.kde.KWin /Scripting org.kde.kwin.Scripting isScriptLoaded s "$PLUGIN_ID")" || { echo "error: isScriptLoaded call failed" >&2; exit 1; }
    if ! echo "$IS_LOADED_OUT" | jq -e '((keys | sort) == ["data","type"]) and (.type == "b") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "boolean")' >/dev/null 2>&1; then
      echo "error: unexpected isScriptLoaded reply: $IS_LOADED_OUT" >&2
      exit 1
    fi
    if [[ "$(echo "$IS_LOADED_OUT" | jq -r '.data[0]')" != "false" ]]; then
      echo "error: plugin '$PLUGIN_ID' is still loaded; refusing to continue (reconfiguration may still be settling)" >&2
      exit 1
    fi
    # 3. Require the Planner D-Bus name to be unowned. Never stop or mask units here.
    if busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s "$PLANNER_BUS" >/dev/null 2>&1; then
      OWNER_DETAIL="$(busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s "$PLANNER_BUS" 2>&1 || true)"
      echo "error: $PLANNER_BUS is still owned ($OWNER_DETAIL); refusing to start worktree Planner" >&2
      echo "hint: if the owner is plasma-auto-tiler-planner.service, stop only that unit, re-verify GetNameOwner fails, then re-run. Do not mask units." >&2
      exit 1
    fi
    # 4. Build. The devenv shell is required only here, and only when outside it.
    if [[ -n "${IN_NIX_SHELL:-}${DEVENV_PROFILE:-}" ]]; then
      ( cd "$REPO_ROOT" && cargo build ) || { echo "error: cargo build failed" >&2; exit 1; }
    else
      devenv shell --impure -- cargo build || { echo "error: cargo build failed (via devenv shell --impure)" >&2; exit 1; }
    fi
    [[ -x "$BIN" ]] || { echo "error: worktree Planner binary missing after build: $BIN" >&2; exit 1; }
    if [[ -e "$REPO_ROOT/result" ]]; then
      echo "error: refusing to proceed with a 'result' symlink present at $REPO_ROOT/result" >&2
      exit 1
    fi
    # 5. Derive the per-run receipt path dynamically under $XDG_RUNTIME_DIR.
    RECEIPT_DIR="$(mktemp -d "$RUNTIME_DIR/plasma-auto-tiler-controller.XXXXXX")" || { echo "error: could not create controller receipt dir" >&2; exit 1; }
    ROLLBACK_RECEIPT_DIR="$RECEIPT_DIR"
    chmod 700 "$RECEIPT_DIR" || { rmdir -- "$RECEIPT_DIR"; echo "error: could not secure controller receipt dir" >&2; exit 1; }
    RECEIPT="$RECEIPT_DIR/ownership"
    if [[ -e "$RECEIPT" || -L "$RECEIPT" ]]; then
      echo "error: controller receipt path already exists: $RECEIPT" >&2
      exit 1
    fi
    # 6. Launch exactly the worktree Planner, detached. $! is a hint only and
    # never authoritative: setsid may fork when it is a process-group leader,
    # so identity is derived from the D-Bus owner instead.
    PLANNER_LOG="$(mktemp /tmp/plasma-auto-tiler-planner-dev.XXXXXX.log)" || { echo "error: could not create planner log" >&2; exit 1; }
    setsid nohup "$BIN" planner-service >"$PLANNER_LOG" 2>&1 </dev/null &
    LAUNCH_PID=$!
    VERIFIED_PID=""
    VERIFIED_EXE=""
    VERIFIED_START=""
    PROVED=0
    for _ in $(seq 1 50); do
      if OWNER_PID="$(planner_dbus_owner_pid 2>/dev/null)"; then
        if CAND_START="$(planner_verify_worktree "$OWNER_PID" 2>/dev/null)"; then
          VERIFIED_PID="$OWNER_PID"
          VERIFIED_EXE="$BIN"
          VERIFIED_START="$CAND_START"
          PROVED=1
          break
        else
          echo "error: $PLANNER_BUS owned by unexpected pid $OWNER_PID (exe/cmdline/start did not verify as worktree $BIN planner-service); refusing (launch hint was ${LAUNCH_PID:-unknown}); rollback will re-enable the packaged script without touching that PID" >&2
          exit 1
        fi
      fi
      sleep 0.2
    done
    if [[ "$PROVED" -ne 1 ]]; then
      echo "error: $PLANNER_BUS was not owned by a verified worktree Planner within the bounded window (launch hint ${LAUNCH_PID:-unknown}); see $PLANNER_LOG" >&2
      exit 1
    fi
    busctl --user status "$PLANNER_BUS" || { echo "error: busctl status for $PLANNER_BUS failed" >&2; exit 1; }
    # 7. Load the worktree KWin bundle. start-test.sh owns the duplicate
    # plugin guard; do not reimplement it here.
    CONTROLLER_OWNERSHIP_FILE="$RECEIPT" bash "$REPO_ROOT/scripts/start-test.sh" start || {
      echo "error: start-test.sh start failed (verified planner ${VERIFIED_PID:-unknown} will be terminated by rollback); see $PLANNER_LOG" >&2
      exit 1
    }
    LOADED_OK=1
    # 8. Print Planner PID plus script ID read from the controller receipt.
    SCRIPT_ID="$(jq -r '.script_id // empty' "$RECEIPT" 2>/dev/null || true)"
    if [[ ! "$SCRIPT_ID" =~ ^[0-9]+$ ]] || [[ "$SCRIPT_ID" -gt 2147483647 ]]; then
      echo "error: controller receipt has no valid script_id: $RECEIPT" >&2
      exit 1
    fi
    mkdir -p "$STATE_DIR" && chmod 700 "$STATE_DIR" || { echo "error: could not create state dir $STATE_DIR" >&2; exit 1; }
    printf '%s\n' "$VERIFIED_PID" > "$STATE_DIR/planner-pid" || { echo "error: could not record planner pid" >&2; exit 1; }
    printf '%s\n' "$VERIFIED_EXE" > "$STATE_DIR/planner-exe" || { echo "error: could not record planner exe" >&2; exit 1; }
    printf '%s\n' "$VERIFIED_START" > "$START_FILE" || { echo "error: could not record planner start identity" >&2; exit 1; }
    printf '%s\n' "$RECEIPT" > "$STATE_DIR/controller-receipt-path" || { echo "error: could not record controller receipt path" >&2; exit 1; }
    printf '%s\n' "$PLANNER_LOG" > "$STATE_DIR/planner-log" || { echo "error: could not record planner log path" >&2; exit 1; }
    ROLLBACK_ARMED=0
    trap - EXIT
    echo "dev-on: planner pid $VERIFIED_PID, script id $SCRIPT_ID"
    echo "planner log: $PLANNER_LOG"
    echo "receipt: $RECEIPT"

# Rebuild and safely swap only the recorded worktree Planner. Never touches the KWin script.
reload:
    #!/usr/bin/env bash
    set -euo pipefail
    REPO_ROOT="{{ justfile_directory() }}"
    PLANNER_BUS="org.plasmaautotiler.Planner"
    BIN="$REPO_ROOT/target/debug/plasma-auto-tiler"
    RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}"
    STATE_DIR="$RUNTIME_DIR/plasma-auto-tiler-dev"
    PID_FILE="$STATE_DIR/planner-pid"
    EXE_FILE="$STATE_DIR/planner-exe"
    START_FILE="$STATE_DIR/planner-start"
    planner_start_identity() {
      local pid="$1" stat_line stat_pid rest
      local -a fields=()
      stat_line="$(<"/proc/$pid/stat")" || return 1
      [[ "$stat_line" != *$'\n'* ]] || return 1
      stat_pid="${stat_line%% *}"
      [[ "$stat_pid" == "$pid" ]] || return 1
      rest="${stat_line##*) }"
      [[ "$rest" != "$stat_line" ]] || return 1
      read -r -a fields <<<"$rest"
      [[ "${#fields[@]}" -ge 20 && "${fields[0]:-}" =~ ^[A-Za-z]$ ]] || return 1
      [[ "${fields[19]:-}" =~ ^[1-9][0-9]*$ ]] || return 1
      printf '%s\n' "${fields[19]}"
    }
    planner_exe_is_worktree() {
      local raw="$1" normalized="$1"
      [[ -n "$raw" ]] || return 1
      case "$BIN" in *" (deleted)") return 1 ;; esac
      case "$normalized" in *" (deleted)") normalized="${normalized%' (deleted)'}"; ;; esac
      case "$normalized" in */nix/store/*) return 1 ;; esac
      [[ "$normalized" == "$BIN" ]] || return 1
    }
    planner_verify_worktree() {
      local pid="$1" exe candidate_start
      [[ "$pid" =~ ^[0-9]+$ ]] || return 1
      [[ -d "/proc/$pid" ]] || return 1
      exe="$(readlink "/proc/$pid/exe" 2>/dev/null || true)"
      planner_exe_is_worktree "$exe" || return 1
      tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -Fq "planner-service" || return 1
      candidate_start="$(planner_start_identity "$pid")" || return 1
      [[ "$candidate_start" =~ ^[1-9][0-9]*$ ]] || return 1
      printf '%s\n' "$candidate_start"
    }
    planner_dbus_owner_pid() {
      local owner_reply owner_name owner_pid
      owner_reply="$(busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s "$PLANNER_BUS" 2>/dev/null)" || return 1
      owner_name="$(echo "$owner_reply" | awk '{print $NF}' | tr -d '\"')"
      [[ -n "$owner_name" ]] || return 1
      owner_pid="$(busctl --user --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetConnectionUnixProcessID s "$owner_name" 2>/dev/null | jq -r '.data[0] // empty' 2>/dev/null || true)"
      [[ "$owner_pid" =~ ^[0-9]+$ ]] || return 1
      printf '%s\n' "$owner_pid"
    }
    [[ -f "$PID_FILE" ]] || { echo "error: no recorded planner pid ($PID_FILE missing); is dev mode on?" >&2; exit 1; }
    [[ -f "$EXE_FILE" ]] || { echo "error: no recorded planner exe ($EXE_FILE missing)" >&2; exit 1; }
    [[ -f "$START_FILE" ]] || { echo "error: no recorded planner start identity ($START_FILE missing)" >&2; exit 1; }
    OLD_PID="$(cat "$PID_FILE")"
    RECORDED_EXE="$(cat "$EXE_FILE")"
    RECORDED_START="$(cat "$START_FILE")"
    [[ "$OLD_PID" =~ ^[0-9]+$ ]] || { echo "error: recorded planner pid is invalid: $OLD_PID" >&2; exit 1; }
    case "$BIN" in *" (deleted)") echo "error: configured worktree binary path is ambiguous ('$BIN'); refusing" >&2; exit 1 ;; esac
    [[ "$RECORDED_EXE" == "$BIN" ]] || { echo "error: recorded planner exe ($RECORDED_EXE) is not the worktree binary ($BIN); refusing" >&2; exit 1; }
    [[ "$RECORDED_START" =~ ^[1-9][0-9]*$ ]] || { echo "error: recorded planner start identity is invalid: $RECORDED_START" >&2; exit 1; }
    [[ -d "/proc/$OLD_PID" ]] || { echo "error: recorded planner pid $OLD_PID is not running" >&2; exit 1; }
    CURRENT_EXE="$(readlink "/proc/$OLD_PID/exe" 2>/dev/null || true)"
    planner_exe_is_worktree "$CURRENT_EXE" || { echo "error: /proc/$OLD_PID/exe is '$CURRENT_EXE', expected '$BIN' (or '$BIN (deleted)'); refusing to touch it" >&2; exit 1; }
    CURRENT_START="$(planner_start_identity "$OLD_PID")" || { echo "error: could not capture planner start identity for pid $OLD_PID; refusing" >&2; exit 1; }
    [[ "$CURRENT_START" == "$RECORDED_START" ]] || { echo "error: planner start identity changed (current $CURRENT_START, recorded $RECORDED_START); refusing" >&2; exit 1; }
    if ! tr '\0' ' ' < "/proc/$OLD_PID/cmdline" 2>/dev/null | grep -Fq "planner-service"; then
      echo "error: pid $OLD_PID cmdline is not planner-service; refusing" >&2
      exit 1
    fi
    OWNER_PID="$(busctl --user --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetConnectionUnixProcessID s "$(busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s "$PLANNER_BUS" 2>/dev/null | awk '{print $NF}' | tr -d '\"')" 2>/dev/null | jq -r '.data[0] // empty' 2>/dev/null || true)"
    [[ "$OWNER_PID" == "$OLD_PID" ]] || { echo "error: $PLANNER_BUS owner pid is '${OWNER_PID:-unowned}', expected recorded pid $OLD_PID; refusing swap" >&2; exit 1; }
    if [[ -n "${IN_NIX_SHELL:-}${DEVENV_PROFILE:-}" ]]; then
      ( cd "$REPO_ROOT" && cargo build ) || { echo "error: cargo build failed; old planner $OLD_PID left running" >&2; exit 1; }
    else
      devenv shell --impure -- cargo build || { echo "error: cargo build failed (via devenv shell --impure); old planner $OLD_PID left running" >&2; exit 1; }
    fi
    [[ -x "$BIN" ]] || { echo "error: worktree Planner binary missing after build: $BIN" >&2; exit 1; }
    # Re-verify identity immediately before terminating (TOCTOU guard).
    # Cargo can atomically replace $BIN, leaving the old exe as "$BIN (deleted)".
    CURRENT_EXE="$(readlink "/proc/$OLD_PID/exe" 2>/dev/null || true)"
    planner_exe_is_worktree "$CURRENT_EXE" || { echo "error: planner identity changed before swap (exe '$CURRENT_EXE'); refusing" >&2; exit 1; }
    CURRENT_START="$(planner_start_identity "$OLD_PID")" || { echo "error: planner identity changed before swap; refusing" >&2; exit 1; }
    [[ "$CURRENT_START" == "$RECORDED_START" ]] || { echo "error: planner start identity changed before swap; refusing" >&2; exit 1; }
    kill "$OLD_PID" || { echo "error: could not terminate planner pid $OLD_PID" >&2; exit 1; }
    for _ in $(seq 1 50); do [[ -d "/proc/$OLD_PID" ]] || break; sleep 0.2; done
    if [[ -d "/proc/$OLD_PID" ]]; then
      echo "error: old planner pid $OLD_PID did not exit; refusing to start a second Planner" >&2
      exit 1
    fi
    PLANNER_LOG="$(mktemp /tmp/plasma-auto-tiler-planner-dev.XXXXXX.log)" || { echo "error: could not create planner log" >&2; exit 1; }
    setsid nohup "$BIN" planner-service >"$PLANNER_LOG" 2>&1 </dev/null &
    LAUNCH_PID=$!
    NEW_PID=""
    NEW_EXE=""
    NEW_START=""
    PROVED=0
    for _ in $(seq 1 50); do
      if OWNER_PID="$(planner_dbus_owner_pid 2>/dev/null)"; then
        if CAND_START="$(planner_verify_worktree "$OWNER_PID" 2>/dev/null)"; then
          NEW_PID="$OWNER_PID"
          NEW_EXE="$BIN"
          NEW_START="$CAND_START"
          PROVED=1
          break
        else
          echo "error: $PLANNER_BUS owned by unexpected pid $OWNER_PID (exe/cmdline/start did not verify as worktree $BIN planner-service); refusing (launch hint was ${LAUNCH_PID:-unknown}); not touching that PID" >&2
          exit 1
        fi
      fi
      sleep 0.2
    done
    if [[ "$PROVED" -ne 1 ]]; then
      echo "error: replacement Planner did not own $PLANNER_BUS within the bounded window (launch hint ${LAUNCH_PID:-unknown}); see $PLANNER_LOG; not touching any unverified PID" >&2
      exit 1
    fi
    kill_verified_replacement() {
      local reverify
      reverify="$(planner_verify_worktree "$NEW_PID" 2>/dev/null || true)"
      if [[ -n "$reverify" && "$reverify" == "$NEW_START" ]]; then
        kill "$NEW_PID" 2>/dev/null || true
      else
        echo "error: replacement planner identity changed for pid $NEW_PID; refusing to kill ambiguously" >&2
      fi
    }
    reload_fail() {
      echo "error: $*" >&2
      if [[ -n "${NEW_PID:-}" && -n "${NEW_START:-}" ]]; then
        kill_verified_replacement
      fi
      exit 1
    }
    printf '%s\n' "$NEW_PID" > "$PID_FILE" || reload_fail "could not record replacement planner pid"
    printf '%s\n' "$NEW_EXE" > "$EXE_FILE" || reload_fail "could not record replacement planner exe"
    printf '%s\n' "$NEW_START" > "$START_FILE" || reload_fail "could not record replacement planner start identity"
    printf '%s\n' "$PLANNER_LOG" > "$STATE_DIR/planner-log" || reload_fail "could not record replacement planner log path"
    echo "reload: old pid $OLD_PID replaced by $NEW_PID (launch hint was ${LAUNCH_PID:-unknown})"

# Unload the exact controller script, stop only the recorded Planner, re-enable packaged script.
dev-off:
    #!/usr/bin/env bash
    set -euo pipefail
    REPO_ROOT="{{ justfile_directory() }}"
    PLANNER_BUS="org.plasmaautotiler.Planner"
    PLUGIN_ID="plasma-auto-tiler-kwin"
    BIN="$REPO_ROOT/target/debug/plasma-auto-tiler"
    RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}"
    STATE_DIR="$RUNTIME_DIR/plasma-auto-tiler-dev"
    PID_FILE="$STATE_DIR/planner-pid"
    EXE_FILE="$STATE_DIR/planner-exe"
    START_FILE="$STATE_DIR/planner-start"
    RECEIPT_PTR="$STATE_DIR/controller-receipt-path"
    planner_start_identity() {
      local pid="$1" stat_line stat_pid rest
      local -a fields=()
      stat_line="$(<"/proc/$pid/stat")" || return 1
      [[ "$stat_line" != *$'\n'* ]] || return 1
      stat_pid="${stat_line%% *}"
      [[ "$stat_pid" == "$pid" ]] || return 1
      rest="${stat_line##*) }"
      [[ "$rest" != "$stat_line" ]] || return 1
      read -r -a fields <<<"$rest"
      [[ "${#fields[@]}" -ge 20 && "${fields[0]:-}" =~ ^[A-Za-z]$ ]] || return 1
      [[ "${fields[19]:-}" =~ ^[1-9][0-9]*$ ]] || return 1
      printf '%s\n' "${fields[19]}"
    }
    planner_exe_is_worktree() {
      local raw="$1" normalized="$1"
      [[ -n "$raw" ]] || return 1
      case "$BIN" in *" (deleted)") return 1 ;; esac
      case "$normalized" in *" (deleted)") normalized="${normalized%' (deleted)'}"; ;; esac
      case "$normalized" in */nix/store/*) return 1 ;; esac
      [[ "$normalized" == "$BIN" ]] || return 1
    }
    # Strict controller fact first; malformed/unknown replies fail closed
    # before any mutation. A known false skips the exact stop entirely.
    IS_LOADED_OUT="$(busctl --user --json=short call org.kde.KWin /Scripting org.kde.kwin.Scripting isScriptLoaded s "$PLUGIN_ID" 2>/dev/null)" || { echo "error: isScriptLoaded call failed" >&2; exit 1; }
    if ! echo "$IS_LOADED_OUT" | jq -e '((keys | sort) == ["data","type"]) and (.type == "b") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "boolean")' >/dev/null 2>&1; then
      echo "error: unexpected isScriptLoaded reply: $IS_LOADED_OUT" >&2
      exit 1
    fi
    CTRL_STATE="unloaded"
    [[ "$(echo "$IS_LOADED_OUT" | jq -r '.data[0]')" == "true" ]] && CTRL_STATE="loaded"
    # Planner fact: verify the recorded Planner without mutating. An absent
    # or unverified Planner is a split, not a rejection of controller teardown.
    PLANNER_OK=0
    PLANNER_REASON="no recorded planner identity"
    RECORDED_PID=""
    RECORDED_EXE=""
    RECORDED_START=""
    if [[ -f "$PID_FILE" && -f "$EXE_FILE" && -f "$START_FILE" ]]; then
      RECORDED_PID="$(cat "$PID_FILE")"
      RECORDED_EXE="$(cat "$EXE_FILE")"
      RECORDED_START="$(cat "$START_FILE")"
      if [[ ! "$RECORDED_PID" =~ ^[0-9]+$ ]]; then
        PLANNER_REASON="recorded planner pid is invalid: $RECORDED_PID"
      elif [[ "$BIN" == *" (deleted)" ]]; then
        PLANNER_REASON="configured worktree binary path is ambiguous ('$BIN')"
      elif [[ "$RECORDED_EXE" != "$BIN" ]]; then
        PLANNER_REASON="recorded planner exe ($RECORDED_EXE) is not the worktree binary ($BIN)"
      elif [[ ! "$RECORDED_START" =~ ^[1-9][0-9]*$ ]]; then
        PLANNER_REASON="recorded planner start identity is invalid: $RECORDED_START"
      elif [[ ! -d "/proc/$RECORDED_PID" ]]; then
        PLANNER_REASON="recorded planner pid $RECORDED_PID is not running"
      else
        CURRENT_EXE="$(readlink "/proc/$RECORDED_PID/exe" 2>/dev/null || true)"
        if ! planner_exe_is_worktree "$CURRENT_EXE"; then
          PLANNER_REASON="/proc/$RECORDED_PID/exe is '$CURRENT_EXE', expected '$BIN' (or '$BIN (deleted)')"
        else
          CURRENT_START="$(planner_start_identity "$RECORDED_PID" 2>/dev/null || true)"
          if [[ -z "$CURRENT_START" ]]; then
            PLANNER_REASON="could not capture planner start identity for pid $RECORDED_PID"
          elif [[ "$CURRENT_START" != "$RECORDED_START" ]]; then
            PLANNER_REASON="planner start identity changed (current $CURRENT_START, recorded $RECORDED_START)"
          elif ! tr '\0' ' ' < "/proc/$RECORDED_PID/cmdline" 2>/dev/null | grep -Fq "planner-service"; then
            PLANNER_REASON="pid $RECORDED_PID cmdline is not planner-service"
          else
            PLANNER_OK=1
            PLANNER_REASON=""
          fi
        fi
      fi
    elif [[ ! -f "$PID_FILE" ]]; then
      PLANNER_REASON="no recorded planner pid ($PID_FILE missing)"
    elif [[ ! -f "$EXE_FILE" ]]; then
      PLANNER_REASON="no recorded planner exe ($EXE_FILE missing)"
    else
      PLANNER_REASON="no recorded planner start identity ($START_FILE missing)"
    fi
    # Controller teardown only when loaded is strictly known. A known false
    # never runs the exact stop and never requires a receipt.
    RECEIPT=""
    SCRIPT_ID=""
    if [[ "$CTRL_STATE" == "loaded" ]]; then
      if [[ -f "$RECEIPT_PTR" ]]; then
        RECEIPT="$(cat "$RECEIPT_PTR")"
      else
        mapfile -t CANDIDATES < <(compgen -G "$RUNTIME_DIR/plasma-auto-tiler-controller.*/ownership" || true)
        LIVE=()
        for c in ${CANDIDATES[@]+"${CANDIDATES[@]}"}; do [[ -f "$c" && ! -L "$c" ]] && LIVE+=("$c"); done
        if [[ "${#LIVE[@]}" -eq 1 ]]; then
          RECEIPT="${LIVE[0]}"
        elif [[ "${#LIVE[@]}" -eq 0 ]]; then
          echo "error: controller is loaded but no controller receipt found under $RUNTIME_DIR (and $RECEIPT_PTR missing); refusing ambiguous teardown" >&2
          exit 1
        else
          echo "error: multiple controller receipts found; refusing ambiguous teardown:" >&2
          printf '  %s\n' "${LIVE[@]}" >&2
          exit 1
        fi
      fi
      [[ -n "$RECEIPT" ]] || { echo "error: empty controller receipt path" >&2; exit 1; }
      [[ -f "$RECEIPT" && ! -L "$RECEIPT" ]] || { echo "error: controller receipt missing or symlinked: $RECEIPT" >&2; exit 1; }
      SCRIPT_ID="$(jq -r '.script_id // empty' "$RECEIPT" 2>/dev/null || true)"
      if [[ ! "$SCRIPT_ID" =~ ^[0-9]+$ ]] || [[ "$SCRIPT_ID" -gt 2147483647 ]]; then
        echo "error: controller receipt has no valid script_id: $RECEIPT" >&2
        exit 1
      fi
      CONTROLLER_OWNERSHIP_FILE="$RECEIPT" bash "$REPO_ROOT/scripts/start-test.sh" stop "$SCRIPT_ID" || { echo "error: start-test.sh stop failed; leaving Planner and packaged script untouched" >&2; exit 1; }
    else
      echo "dev-off: controller '$PLUGIN_ID' already unloaded; skipping exact stop"
    fi
    # Planner teardown only when verified, with a re-check immediately
    # before TERM. An unverified Planner is never killed.
    PLANNER_STOPPED=0
    if [[ "$PLANNER_OK" -eq 1 ]]; then
      [[ -d "/proc/$RECORDED_PID" ]] || { echo "error: recorded planner pid $RECORDED_PID is not running after script stop" >&2; exit 1; }
      RECHECK_EXE="$(readlink "/proc/$RECORDED_PID/exe" 2>/dev/null || true)"
      planner_exe_is_worktree "$RECHECK_EXE" || { echo "error: /proc/$RECORDED_PID/exe is '$RECHECK_EXE', expected '$BIN' (or '$BIN (deleted)'); refusing to kill" >&2; exit 1; }
      RECHECK_START="$(planner_start_identity "$RECORDED_PID")" || { echo "error: planner start identity changed after script stop; refusing" >&2; exit 1; }
      [[ "$RECHECK_START" == "$RECORDED_START" ]] || { echo "error: planner start identity changed after script stop (current $RECHECK_START, recorded $RECORDED_START); refusing" >&2; exit 1; }
      if ! tr '\0' ' ' < "/proc/$RECORDED_PID/cmdline" 2>/dev/null | grep -Fq "planner-service"; then
        echo "error: pid $RECORDED_PID cmdline is not planner-service; refusing" >&2
        exit 1
      fi
      kill "$RECORDED_PID" || { echo "error: could not terminate planner pid $RECORDED_PID" >&2; exit 1; }
      for _ in $(seq 1 50); do [[ -d "/proc/$RECORDED_PID" ]] || break; sleep 0.2; done
      if [[ -d "/proc/$RECORDED_PID" ]]; then
        echo "error: planner pid $RECORDED_PID did not exit after SIGTERM; refusing to SIGKILL ambiguously" >&2
        exit 1
      fi
      PLANNER_STOPPED=1
    else
      echo "dev-off: no verified worktree Planner to stop ($PLANNER_REASON); skipping Planner kill"
    fi
    bash "$REPO_ROOT/scripts/dogfood-install.sh" enable || { echo "error: dogfood-install.sh enable failed" >&2; exit 1; }
    rm -f -- "$PID_FILE" "$EXE_FILE" "$START_FILE" "$RECEIPT_PTR" "$STATE_DIR/planner-log"
    rmdir -- "$STATE_DIR" 2>/dev/null || true
    if [[ -n "$RECEIPT" ]]; then
      PARENT_DIR="$(dirname -- "$RECEIPT")"
      case "$PARENT_DIR" in
        "$RUNTIME_DIR"/plasma-auto-tiler-controller.*)
          rmdir -- "$PARENT_DIR" 2>/dev/null || true
          ;;
        *) echo "error: refusing to remove unexpected receipt dir $PARENT_DIR" >&2 ;;
      esac
    fi
    if [[ "$CTRL_STATE" == "loaded" && "$PLANNER_STOPPED" -eq 1 ]]; then
      echo "dev-off: script $SCRIPT_ID unloaded, planner $RECORDED_PID stopped, packaged script re-enabled"
    elif [[ "$CTRL_STATE" == "loaded" ]]; then
      echo "dev-off: script $SCRIPT_ID unloaded, no verified planner to stop, packaged script re-enabled"
    elif [[ "$PLANNER_STOPPED" -eq 1 ]]; then
      echo "dev-off: controller already unloaded, planner $RECORDED_PID stopped, packaged script re-enabled"
    else
      echo "dev-off: controller already unloaded, no verified planner to stop, packaged script re-enabled"
    fi

# Read-only dev session report. Never mutates.
dev-status:
    #!/usr/bin/env bash
    set -euo pipefail
    REPO_ROOT="{{ justfile_directory() }}"
    PLUGIN_ID="plasma-auto-tiler-kwin"
    PLANNER_BUS="org.plasmaautotiler.Planner"
    PLANNER_UNIT="plasma-auto-tiler-planner.service"
    BIN="$REPO_ROOT/target/debug/plasma-auto-tiler"
    RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}"
    STATE_DIR="$RUNTIME_DIR/plasma-auto-tiler-dev"
    planner_start_identity() {
      local pid="$1" stat_line stat_pid rest
      local -a fields=()
      stat_line="$(<"/proc/$pid/stat")" || return 1
      [[ "$stat_line" != *$'\n'* ]] || return 1
      stat_pid="${stat_line%% *}"
      [[ "$stat_pid" == "$pid" ]] || return 1
      rest="${stat_line##*) }"
      [[ "$rest" != "$stat_line" ]] || return 1
      read -r -a fields <<<"$rest"
      [[ "${#fields[@]}" -ge 20 && "${fields[0]:-}" =~ ^[A-Za-z]$ ]] || return 1
      [[ "${fields[19]:-}" =~ ^[1-9][0-9]*$ ]] || return 1
      printf '%s\n' "${fields[19]}"
    }
    planner_exe_is_worktree() {
      local raw="$1" normalized="$1"
      [[ -n "$raw" ]] || return 1
      case "$BIN" in *" (deleted)") return 1 ;; esac
      case "$normalized" in *" (deleted)") normalized="${normalized%' (deleted)'}"; ;; esac
      case "$normalized" in */nix/store/*) return 1 ;; esac
      [[ "$normalized" == "$BIN" ]] || return 1
    }
    planner_verify_worktree() {
      local pid="$1" exe candidate_start
      [[ "$pid" =~ ^[0-9]+$ ]] || return 1
      [[ -d "/proc/$pid" ]] || return 1
      exe="$(readlink "/proc/$pid/exe" 2>/dev/null || true)"
      planner_exe_is_worktree "$exe" || return 1
      tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -Fq "planner-service" || return 1
      candidate_start="$(planner_start_identity "$pid")" || return 1
      [[ "$candidate_start" =~ ^[1-9][0-9]*$ ]] || return 1
      printf '%s\n' "$candidate_start"
    }
    echo "planner name: $PLANNER_BUS"
    if OWNER_REPLY="$(busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s "$PLANNER_BUS" 2>/dev/null)"; then
      OWNER_NAME="$(echo "$OWNER_REPLY" | awk '{print $NF}' | tr -d '\"')"
      echo "name owner: $OWNER_NAME"
      if OWNER_PID="$(busctl --user --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetConnectionUnixProcessID s "$OWNER_NAME" 2>/dev/null | jq -r '.data[0] // empty' 2>/dev/null)"; then
        echo "owner pid: ${OWNER_PID:-unknown}"
        if [[ -n "${OWNER_PID:-}" && -d "/proc/$OWNER_PID" ]]; then
          echo "owner exe: $(readlink "/proc/$OWNER_PID/exe" 2>/dev/null || echo unknown)"
        else
          echo "owner exe: unknown"
        fi
      fi
    else
      echo "name owner: unowned"
    fi
    IS_LOADED_OUT="$(busctl --user --json=short call org.kde.KWin /Scripting org.kde.kwin.Scripting isScriptLoaded s "$PLUGIN_ID" 2>/dev/null || true)"
    if echo "$IS_LOADED_OUT" | jq -e '((keys | sort) == ["data","type"]) and (.type == "b") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "boolean")' >/dev/null 2>&1; then
      echo "isScriptLoaded($PLUGIN_ID): $(echo "$IS_LOADED_OUT" | jq -r '.data[0]')"
    else
      echo "isScriptLoaded($PLUGIN_ID): unknown ($IS_LOADED_OUT)"
    fi
    RECEIPT=""
    if [[ -f "$STATE_DIR/controller-receipt-path" ]]; then
      RECEIPT="$(cat "$STATE_DIR/controller-receipt-path")"
      echo "receipt pointer: $RECEIPT"
    fi
    if [[ -z "$RECEIPT" ]]; then
      mapfile -t CANDIDATES < <(compgen -G "$RUNTIME_DIR/plasma-auto-tiler-controller.*/ownership" || true)
      LIVE=()
      for c in ${CANDIDATES[@]+"${CANDIDATES[@]}"}; do [[ -f "$c" && ! -L "$c" ]] && LIVE+=("$c"); done
      if [[ "${#LIVE[@]}" -eq 1 ]]; then
        RECEIPT="${LIVE[0]}"
        echo "receipt (found): $RECEIPT"
      elif [[ "${#LIVE[@]}" -eq 0 ]]; then
        echo "recorded script id: none (no receipt found)"
        RECEIPT=""
      else
        echo "recorded script id: ambiguous (${#LIVE[@]} receipts found)"
        printf '  %s\n' "${LIVE[@]}"
        RECEIPT=""
      fi
    fi
    if [[ -n "$RECEIPT" ]]; then
      if [[ -f "$RECEIPT" && ! -L "$RECEIPT" ]]; then
        SID="$(jq -r '.script_id // empty' "$RECEIPT" 2>/dev/null || true)"
        echo "recorded script id: ${SID:-unknown}"
      else
        echo "recorded script id: unknown (receipt missing: $RECEIPT)"
      fi
    fi
    if [[ -f "$STATE_DIR/planner-pid" ]]; then
      echo "recorded planner pid: $(cat "$STATE_DIR/planner-pid")"
    else
      echo "recorded planner pid: none"
    fi
    if command -v systemctl >/dev/null 2>&1; then
      echo "unit $PLANNER_UNIT active: $(systemctl --user is-active "$PLANNER_UNIT" 2>&1 || true)"
      echo "unit $PLANNER_UNIT enabled: $(systemctl --user is-enabled "$PLANNER_UNIT" 2>&1 || true)"
    else
      echo "unit $PLANNER_UNIT: systemctl not available"
    fi
    PLANNER_FACT="unknown"
    PLANNER_DETAIL=""
    if OWNER_REPLY2="$(busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s "$PLANNER_BUS" 2>/dev/null)"; then
      OWNER_NAME2="$(echo "$OWNER_REPLY2" | awk '{print $NF}' | tr -d '\"')"
      if [[ -z "$OWNER_NAME2" ]]; then
        PLANNER_FACT="unknown"
        PLANNER_DETAIL="empty owner name"
      elif OWNER_PID2="$(busctl --user --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetConnectionUnixProcessID s "$OWNER_NAME2" 2>/dev/null | jq -r '.data[0] // empty' 2>/dev/null)" && [[ "$OWNER_PID2" =~ ^[0-9]+$ ]]; then
        if VSTART="$(planner_verify_worktree "$OWNER_PID2" 2>/dev/null)"; then
          PLANNER_FACT="verified"
          PLANNER_DETAIL="pid $OWNER_PID2"
        else
          PLANNER_FACT="owned-unverified"
          PLANNER_DETAIL="pid $OWNER_PID2 did not verify as worktree $BIN planner-service"
        fi
      else
        PLANNER_FACT="unknown"
        PLANNER_DETAIL="owner PID unavailable or malformed"
      fi
    else
      PLANNER_FACT="unowned"
      PLANNER_DETAIL="name unowned"
    fi
    CTRL_FACT="unknown"
    CTRL_RAW="$(busctl --user --json=short call org.kde.KWin /Scripting org.kde.kwin.Scripting isScriptLoaded s "$PLUGIN_ID" 2>/dev/null || true)"
    if echo "$CTRL_RAW" | jq -e '((keys | sort) == ["data","type"]) and (.type == "b") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "boolean")' >/dev/null 2>&1; then
      if [[ "$(echo "$CTRL_RAW" | jq -r '.data[0]')" == "true" ]]; then
        CTRL_FACT="loaded"
      else
        CTRL_FACT="unloaded"
      fi
    fi
    if [[ "$PLANNER_FACT" == "verified" && "$CTRL_FACT" == "loaded" ]]; then
      echo "dev mode: UP (planner $PLANNER_DETAIL verified, controller loaded)"
    elif [[ "$PLANNER_FACT" == "unowned" && "$CTRL_FACT" == "unloaded" ]]; then
      echo "dev mode: DOWN (planner unowned, controller unloaded)"
    elif [[ "$PLANNER_FACT" == "unknown" || "$CTRL_FACT" == "unknown" ]]; then
      echo "dev mode: UNKNOWN (planner $PLANNER_FACT${PLANNER_DETAIL:+, $PLANNER_DETAIL}, controller $CTRL_FACT)"
    elif [[ "$PLANNER_FACT" == "verified" ]]; then
      echo "dev mode: SPLIT (planner $PLANNER_DETAIL verified, controller $CTRL_FACT)"
    elif [[ "$CTRL_FACT" == "loaded" ]]; then
      echo "dev mode: SPLIT (planner $PLANNER_FACT${PLANNER_DETAIL:+, $PLANNER_DETAIL}, controller loaded)"
    else
      echo "dev mode: SPLIT (planner $PLANNER_FACT${PLANNER_DETAIL:+, $PLANNER_DETAIL}, controller $CTRL_FACT)"
    fi
