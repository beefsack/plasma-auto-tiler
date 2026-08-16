#!/usr/bin/env bash
set -uo pipefail

SELF="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/$(basename -- "${BASH_SOURCE[0]}")"
BASH_BIN="${BASH:-$(command -v bash)}"

PLUGIN_ID="plasma-auto-tiler-active-border"

usage() {
  cat <<EOF
Usage: $(basename -- "$0") <command>

Commands:
  run [--quick]   Validate the native effect in a private nested Wayland KWin.
  --help          Show this help.
EOF
}

fail() {
  echo "$1" >&2
  exit 1
}

resolve_tool() {
  local name="$1" cmd="$2"
  local path="${!name:-}"
  if [[ -z "$path" ]]; then
    path="$(type -P "$cmd" 2>/dev/null || true)"
  fi
  if [[ -z "$path" || "$path" != /* || ! -x "$path" ]]; then
    echo "missing required tool: $name" >&2
    return 1
  fi
  printf -v "$name" '%s' "$path"
  return 0
}

__session() {
  # setsid creates the group; job control would make the setsid wrapper a group
  # leader and allow implementations to fork before the launched PID is known.
  set +m

  local nested_pid="" nested_pgid=""
  local client_a_pid="" client_a_pgid="" client_b_pid="" client_b_pgid=""
  local client_a_started=0 client_b_started=0
  local loaded="" status="" i="" journal_since="" cleanup_failed=0 nested_ready=0
  local renderer="" quoted_compositing_type=""
  local compositing_attempts=0 compositing_probes_done=0 compositing_status=0 compositing_stdout="" compositing_stderr=""
  local compositing_stdout_file="" compositing_stderr_file=""
  local loaded_by_us=0
  local effect_output="" quoted_effects_response=""
  local effects_attempts=0 effects_probes_done=0 effects_status=0 effects_stdout="" effects_stderr=""
  local effects_stdout_file="" effects_stderr_file=""
  local inner_identity_file="" inner_identity_tmp=""

  effects_call() {
    local method="$1"
    "$DBUS_CALL_BIN" call --address "${DBUS_SESSION_BUS_ADDRESS:-}" \
      --dest org.kde.KWin --object-path /Effects \
      --method "org.kde.kwin.Effects.$method" "$PLUGIN_ID"
  }

  compositing_type_probe() {
    local stdout_file="$1" stderr_file="$2"
    "$DBUS_CALL_BIN" call --address "${DBUS_SESSION_BUS_ADDRESS:-}" \
      --dest org.kde.KWin --object-path /Compositor \
      --method org.freedesktop.DBus.Properties.Get \
      org.kde.kwin.Compositing compositingType >"$stdout_file" 2>"$stderr_file"
  }

  effects_support_probe() {
    local stdout_file="$1" stderr_file="$2"
    effects_call supportInformation >"$stdout_file" 2>"$stderr_file"
  }

  effect_bool() {
    local output="$1"
    output="${output#"${output%%[![:space:]]*}"}"
    output="${output%"${output##*[![:space:]]}"}"
    case "$output" in
      "(true,)") return 0 ;;
      "(false,)") return 1 ;;
      *) return 2 ;;
    esac
  }

  record_compositing_readiness() {
    local quoted_stdout="" quoted_stderr="" recorded_status=""
    printf -v quoted_stdout '%q' "$compositing_stdout"
    printf -v quoted_stderr '%q' "$compositing_stderr"
    if [[ "$compositing_probes_done" -eq 0 ]]; then
      recorded_status="not-run"
    else
      recorded_status="$compositing_status"
    fi
    mark "compositing readiness attempts=$compositing_probes_done status=$recorded_status renderer=${renderer:-none} stdout_file=$compositing_stdout_file stdout=$quoted_stdout stderr_file=$compositing_stderr_file stderr=$quoted_stderr"
  }

  record_effects_readiness() {
    local quoted_stdout="" quoted_stderr="" recorded_status=""
    printf -v quoted_stdout '%q' "$effects_stdout"
    printf -v quoted_stderr '%q' "$effects_stderr"
    if [[ "$effects_probes_done" -eq 0 ]]; then
      recorded_status="not-run"
    else
      recorded_status="$effects_status"
    fi
    mark "effects readiness attempts=$effects_probes_done status=$recorded_status stdout_file=$effects_stdout_file stdout=$quoted_stdout stderr_file=$effects_stderr_file stderr=$quoted_stderr"
  }

  record_dbus() {
    printf 'dbus: %s\n' "$*" >> "$EVIDENCE_ROOT/transitions.log" 2>/dev/null || true
  }

  effects_request() {
    local method="$1" output="" quoted="" result=0
    record_dbus "request method=$method address=${DBUS_SESSION_BUS_ADDRESS:-unavailable} plugin=$PLUGIN_ID"
    output="$(effects_call "$method" 2>&1)" || result=$?
    printf -v quoted '%q' "$output"
    record_dbus "result method=$method status=$result response=$quoted"
    if [[ "$result" -eq 0 ]]; then
      printf '%s\n' "$output"
      return 0
    fi
    return "$result"
  }

  mark() {
    printf 'lifecycle: %s\n' "$*" >> "$EVIDENCE_ROOT/manifest.txt" 2>/dev/null || true
  }

  owned_group_pgid() {
    local name="$1" pid="$2" inspection="" reported_pid="" reported_pgid="" ps_status=0 quoted_inspection=""
    local stdout_file="$EVIDENCE_ROOT/ownership-${name}-ps.stdout.log" stderr_file="$EVIDENCE_ROOT/ownership-${name}-ps.stderr.log"
    local stderr="" quoted_stderr="" stdout_capture_bytes=0 stdout_capture_limit=4096 stdout_oversized=0
    local LC_ALL=C
    if [[ ! "$pid" =~ ^[0-9]+$ ]]; then
      mark "ownership group=$name pid=$pid result=refused reason=invalid-launched-pid"
      return 1
    fi
    if ! : > "$stdout_file" 2>/dev/null || ! : > "$stderr_file" 2>/dev/null; then
      mark "ownership group=$name pid=$pid result=refused reason=evidence-preparation-failed"
      return 1
    fi
    "$PS_BIN" -o pid= -o pgid= -p "$pid" 2>>"$stderr_file" | (
      IFS= read -r -N "$((stdout_capture_limit + 1))" inspection || true
      printf '%s' "$inspection" > "$stdout_file"
    )
    ps_status=${PIPESTATUS[0]}
    inspection="$(<"$stdout_file")"
    stdout_capture_bytes=${#inspection}
    if [[ "$stdout_capture_bytes" -gt "$stdout_capture_limit" ]]; then
      stdout_oversized=1
    fi
    IFS= read -r -N 4096 stderr < "$stderr_file" || true
    printf -v quoted_inspection '%q' "$inspection"
    printf -v quoted_stderr '%q' "$stderr"
    mark "ownership probe group=$name pid=$pid ps_status=$ps_status stdout_file=$stdout_file stdout_capture_bytes=$stdout_capture_bytes stdout_capture_limit=$stdout_capture_limit stdout_oversized=$stdout_oversized stdout=$quoted_inspection stderr_file=$stderr_file stderr=$quoted_stderr"
    if [[ "$stdout_oversized" -ne 0 ]]; then
      mark "ownership group=$name pid=$pid result=refused reason=stdout-oversized"
      return 1
    fi
    if [[ "$ps_status" -ne 0 ]]; then
      mark "ownership group=$name pid=$pid result=refused reason=ps-failed"
      return 1
    fi
    if [[ ! "$inspection" =~ ^[[:blank:]]*([0-9]+)[[:blank:]]+([0-9]+)[[:blank:]]*$ ]]; then
      mark "ownership group=$name pid=$pid result=refused reason=unprovable-identity"
      return 1
    fi
    reported_pid="${BASH_REMATCH[1]}"
    reported_pgid="${BASH_REMATCH[2]}"
    if [[ "$reported_pid" != "$pid" || "$reported_pgid" != "$pid" ]]; then
      mark "ownership group=$name pid=$pid result=refused reason=pid-pgid-mismatch reported_pid=$reported_pid reported_pgid=$reported_pgid"
      return 1
    fi
    printf '%s' "$reported_pgid"
  }

  establish_owned_group() {
    local name="$1" pid="$2" verified_pgid="" attempts=0

    if [[ ! "$pid" =~ ^[1-9][0-9]*$ ]]; then
      mark "ownership establishment group=$name pid=$pid attempts=$attempts final=refused reason=invalid-launched-pid"
      return 1
    fi
    for ((attempts = 1; attempts <= 10; attempts++)); do
      if ! "$KILL_BIN" -0 -- "$pid" 2>/dev/null; then
        mark "ownership establishment group=$name pid=$pid attempts=$((attempts - 1)) final=refused reason=pid-not-alive"
        return 1
      fi
      if verified_pgid="$(owned_group_pgid "$name" "$pid")"; then
        mark "ownership establishment group=$name pid=$pid attempts=$attempts final=verified pgid=$verified_pgid"
        printf '%s' "$verified_pgid"
        return 0
      fi
      if [[ "$attempts" -lt 10 ]]; then
        "$SLEEP_BIN" 0.1
      fi
    done
    mark "ownership establishment group=$name pid=$pid attempts=$((attempts - 1)) final=refused reason=probe-never-verified"
    return 1
  }

  capture_journal() {
    local journal_until=""
    [[ -n "$nested_pid" ]] || return 0
    journal_until="${EPOCHREALTIME:-$EPOCHSECONDS}"
    if [[ -z "${JOURNALCTL_BIN:-}" || ! -x "$JOURNALCTL_BIN" ]]; then
      mark "journal unavailable pid=$nested_pid reason=journalctl-missing"
      return 0
    fi
    mark "journal request pid=$nested_pid since=@$journal_since until=@$journal_until"
    if "$JOURNALCTL_BIN" --no-pager --output=short-iso --since "@$journal_since" \
      --until "@$journal_until" "_PID=$nested_pid" >"$EVIDENCE_ROOT/journal.log" 2>&1; then
      mark "journal captured pid=$nested_pid"
    else
      rm -f "$EVIDENCE_ROOT/journal.log"
      mark "journal unavailable pid=$nested_pid reason=query-failed"
    fi
  }

  terminate_owned_group() {
    local name="$1" pid="$2" pgid="$3"
    local verified_pgid=""
    if [[ -z "$pgid" || "$pgid" =~ [^0-9] || "$pid" != "$pgid" ]]; then
      mark "cleanup group=$name result=no-recorded-owner"
      cleanup_failed=1
      return 1
    fi
    if ! "$KILL_BIN" -0 -- "-$pgid" 2>/dev/null; then
      mark "cleanup verify group=$name result=already-stopped"
      return 0
    fi
    if ! verified_pgid="$(owned_group_pgid "$name" "$pid")" || [[ "$verified_pgid" != "$pgid" ]]; then
      mark "cleanup revalidate group=$name result=unverified"
      mark "cleanup group=$name result=ownership-unverified"
      cleanup_failed=1
      return 1
    fi
    mark "cleanup revalidate group=$name result=verified pid=$pid pgid=$pgid"
    mark "cleanup request group=$name pid=$pid pgid=$pgid"
    if "$KILL_BIN" -TERM -- "-$pgid" 2>/dev/null; then
      mark "cleanup signal group=$name result=sent"
    else
      mark "cleanup signal group=$name result=not-running-or-failed"
    fi
    for ((i = 0; i < 100; i++)); do
      if ! "$KILL_BIN" -0 -- "-$pgid" 2>/dev/null; then
        wait "$pid" 2>/dev/null || true
        mark "cleanup verify group=$name result=gone"
        return 0
      fi
      "$SLEEP_BIN" 0.1
    done
    mark "cleanup verify group=$name result=remaining"
    cleanup_failed=1
    return 1
  }

  cleanup_owned() {
    if [[ "${CLEANUP_DONE:-0}" -eq 1 ]]; then
      return "${CLEANUP_RESULT:-0}"
    fi
    CLEANUP_DONE=1
    # Unload only what this run loaded, and only while the private bus is
    # reachable; an unreachable bus never turns a failure into success.
    if [[ "$loaded_by_us" -eq 1 ]]; then
      if effects_request unloadEffect >/dev/null; then
        if loaded="$(effects_request isEffectLoaded)" && [[ "$loaded" != *true* ]]; then
          loaded_by_us=0
          mark "cleanup unload result=verified-unloaded"
        else
          mark "cleanup unload result=verification-failed"
          cleanup_failed=1
        fi
      else
        mark "cleanup unload result=unreachable-or-failed"
        cleanup_failed=1
      fi
    fi
    capture_journal
    # Exact recorded owned groups only: clients first, then the nested
    # launcher. Each group must disappear before cleanup can succeed.
    if [[ "$client_a_started" -eq 1 ]]; then
      terminate_owned_group client-a "$client_a_pid" "$client_a_pgid" || true
    else
      mark "cleanup group=client-a result=not-started"
    fi
    if [[ "$client_b_started" -eq 1 ]]; then
      terminate_owned_group client-b "$client_b_pid" "$client_b_pgid" || true
    else
      mark "cleanup group=client-b result=not-started"
    fi
    terminate_owned_group nested "$nested_pid" "$nested_pgid" || true
    if [[ "$cleanup_failed" -eq 0 ]]; then
      mark "cleanup complete"
      CLEANUP_RESULT=0
    else
      mark "cleanup failed"
      CLEANUP_RESULT=1
    fi
    return "$CLEANUP_RESULT"
  }

  trap 'cleanup_owned || true' EXIT
  trap 'cleanup_owned || true; exit 143' TERM

  printf 'session_pid=%s\n' "$$" >> "$EVIDENCE_ROOT/manifest.txt"

  # Atomically publish only the inner-runner PID. The outer wrapper validates
  # the PID against current ps observation (live, distinct from the session
  # leader, directly parented by the still-live session leader) before any
  # signal is forwarded. The inner runner's SIGINT is ignored by the background
  # launch, so only TERM reaches it; INT/TERM both arrive as TERM here.
  inner_identity_file="$EVIDENCE_ROOT/inner-identity"
  inner_identity_tmp="$EVIDENCE_ROOT/.inner-identity.tmp"
  printf 'pid=%s\n' "$$" > "$inner_identity_tmp"
  mv -f -- "$inner_identity_tmp" "$inner_identity_file"
  mark "inner identity published pid=$$"

  mark "session started"

  # Restore the exact caller XDG_DATA_DIRS state captured before dbus-run-session
  # sanitized it, so nested KWin and its clients see the caller's environment
  # rather than the sanitized daemon activation-search path.
  if [[ "${RUNNER_OUTER_XDG_DATA_DIRS_SET:-0}" -eq 1 ]]; then
    export XDG_DATA_DIRS="${RUNNER_OUTER_XDG_DATA_DIRS-}"
  else
    unset XDG_DATA_DIRS
  fi

  journal_since="${EPOCHREALTIME:-$EPOCHSECONDS}"
  "$SETSID_BIN" "$KWIN_WAYLAND_BIN" --wayland-display "$RUNNER_HOST_SOCKET" --socket "$RUNNER_NESTED_SOCKET" \
    >"$EVIDENCE_ROOT/nested.log" 2>&1 &
  nested_pid=$!
  if ! nested_pgid="$(establish_owned_group nested "$nested_pid")"; then
    fail "could not establish nested launcher ownership (pid $nested_pid)"
  fi

  {
    printf 'nested_pid=%s\n' "$nested_pid"
    printf 'nested_pgid=%s\n' "$nested_pgid"
  } > "$EVIDENCE_ROOT/owned-pids"
  mark "nested launcher spawned pid=$nested_pid pgid=$nested_pgid"

  # Wait for the private Wayland socket (compositor ready); fail closed on any
  # early exit - including exit 0 - or a socket that never appears.
  for ((i = 0; i < 100; i++)); do
    if ! "$KILL_BIN" -0 "$nested_pid" 2>/dev/null; then
      wait "$nested_pid" 2>/dev/null
      status=$?
      fail "nested compositor exited before ready (status $status)"
    fi
    if [[ -e "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]]; then
      nested_ready=1
      break
    fi
    "$SLEEP_BIN" 0.1
  done
  if [[ "$nested_ready" -ne 1 ]]; then
    fail "nested compositor did not become ready"
  fi
  mark "nested compositor ready"

  # Fail closed unless the forced OpenGL scene is active. Poll the private
  # nested /Compositor compositingType under a bounded short retry budget. The
  # org.kde.kwin.Compositing compositingType property is a string whose
  # documented values are none/gl1/gl2/gles; only gl2/gles satisfy the OpenGL
  # requirement, never none or the gl1 fallback. Query-unavailable stays
  # distinct from a valid non-OpenGL response: a returned none/gl1/other fails
  # as non-OpenGL, while an exhausted unavailable query reports unavailable
  # rather than a returned compositor type. The plugin is never discovered or
  # loaded before a successful OpenGL probe.
  renderer=""
  compositing_attempts=0
  compositing_stdout_file="$EVIDENCE_ROOT/compositing-readiness.stdout.log"
  compositing_stderr_file="$EVIDENCE_ROOT/compositing-readiness.stderr.log"
  : > "$compositing_stdout_file"
  : > "$compositing_stderr_file"
  while [[ "$compositing_attempts" -lt 20 ]]; do
    compositing_attempts=$((compositing_attempts + 1))
    if ! "$KILL_BIN" -0 "$nested_pid" 2>/dev/null; then
      wait "$nested_pid" 2>/dev/null
      status=$?
      record_compositing_readiness
      fail "nested compositor exited during compositing readiness (status $status)"
    fi
    if compositing_type_probe "$compositing_stdout_file" "$compositing_stderr_file"; then
      compositing_status=0
    else
      compositing_status=$?
    fi
    compositing_probes_done=$((compositing_probes_done + 1))
    compositing_stdout="$(<"$compositing_stdout_file")"
    compositing_stderr="$(<"$compositing_stderr_file")"
    if [[ "$compositing_status" -eq 0 ]]; then
      case "$compositing_stdout" in
        *"'gl2'"*) renderer=gl2 ;;
        *"'gles'"*) renderer=gles ;;
      esac
      if [[ -n "$renderer" ]]; then
        break
      fi
      record_compositing_readiness
      fail "OpenGL compositing not active (compositingType: ${compositing_stdout:-unavailable})"
    fi
    "$SLEEP_BIN" 0.1
  done

  if [[ -z "$renderer" ]]; then
    record_compositing_readiness
    fail "nested compositor did not report an OpenGL compositing type (query unavailable)"
  fi

  record_compositing_readiness
  printf -v quoted_compositing_type '%q' "$compositing_stdout"
  mark "renderer transition result=verified renderer=$renderer"
  record_dbus "renderer transition result=verified renderer=$renderer response=$quoted_compositing_type"

  # Discover /Effects under a bounded short retry budget, distinct from
  # compositor readiness and from effect support: an exhausted query reports
  # unavailable, never unsupported.
  effects_attempts=0
  effects_probes_done=0
  effects_status=0
  effects_stdout=""
  effects_stderr=""
  effects_stdout_file="$EVIDENCE_ROOT/effects-readiness.stdout.log"
  effects_stderr_file="$EVIDENCE_ROOT/effects-readiness.stderr.log"
  : > "$effects_stdout_file"
  : > "$effects_stderr_file"
  while [[ "$effects_attempts" -lt 20 ]]; do
    effects_attempts=$((effects_attempts + 1))
    if ! "$KILL_BIN" -0 "$nested_pid" 2>/dev/null; then
      wait "$nested_pid" 2>/dev/null
      status=$?
      record_effects_readiness
      fail "nested compositor exited during /Effects readiness (status $status)"
    fi
    if effects_support_probe "$effects_stdout_file" "$effects_stderr_file"; then
      effects_status=0
    else
      effects_status=$?
    fi
    effects_probes_done=$((effects_probes_done + 1))
    effects_stdout="$(<"$effects_stdout_file")"
    effects_stderr="$(<"$effects_stderr_file")"
    if [[ "$effects_status" -eq 0 ]]; then
      break
    fi
    "$SLEEP_BIN" 0.1
  done

  if [[ "$effects_status" -ne 0 ]]; then
    record_effects_readiness
    fail "nested /Effects unavailable (query exhausted)"
  fi

  record_effects_readiness
  printf -v quoted_effects_response '%q' "$effects_stdout"
  record_dbus "effects readiness result=verified response=$quoted_effects_response"

  # Support check: isEffectSupported is a real boolean. An explicit false is a
  # distinct factory-support failure, while an unavailable/error query remains
  # an endpoint/query failure, never unsupported.
  if ! effect_output="$(effects_request isEffectSupported)"; then
    fail "could not determine effect support"
  fi
  effect_bool "$effect_output"
  case $? in
    0) : ;;
    1) fail "effect factory support check returned false (isEffectSupported=false)" ;;
    2) fail "could not determine effect support" ;;
  esac

  # Initial state must be unloaded.
  if ! loaded="$(effects_request isEffectLoaded)"; then
    fail "could not determine initial effect state"
  fi
  if [[ "$loaded" == *true* ]]; then
    fail "effect already loaded"
  fi

  # Load the effect. loadEffect is a real boolean: an explicit false is a
  # distinct rejection, while an unavailable/error query remains an
  # endpoint/query failure.
  if ! effect_output="$(effects_request loadEffect)"; then
    fail "effect load failed"
  fi
  effect_bool "$effect_output"
  case $? in
    0) : ;;
    1) fail "effect load rejected" ;;
    2) fail "effect load failed" ;;
  esac
  loaded_by_us=1

  # Post-load check.
  if ! loaded="$(effects_request isEffectLoaded)"; then
    fail "could not determine post-load effect state"
  fi
  if [[ "$loaded" != *true* ]]; then
    fail "effect not loaded after load"
  fi
  mark "effect loaded"

  # Two Wayland-native clients, each in its own recorded process group.
  client_a_started=1
  "$SETSID_BIN" "$WESTON_TERMINAL_BIN" >"$EVIDENCE_ROOT/client-a.log" 2>&1 &
  client_a_pid=$!
  if ! client_a_pgid="$(establish_owned_group client-a "$client_a_pid")"; then
    fail "could not establish client-a ownership (pid $client_a_pid)"
  fi
  {
    printf 'client_a_pid=%s\n' "$client_a_pid"
    printf 'client_a_pgid=%s\n' "$client_a_pgid"
  } >> "$EVIDENCE_ROOT/owned-pids"

  client_b_started=1
  "$SETSID_BIN" "$WESTON_TERMINAL_BIN" >"$EVIDENCE_ROOT/client-b.log" 2>&1 &
  client_b_pid=$!
  if ! client_b_pgid="$(establish_owned_group client-b "$client_b_pid")"; then
    fail "could not establish client-b ownership (pid $client_b_pid)"
  fi
  if ! "$KILL_BIN" -0 "$client_a_pid" 2>/dev/null || ! "$KILL_BIN" -0 "$client_b_pid" 2>/dev/null; then
    fail "a client exited before both client groups were established"
  fi

  {
    printf 'client_b_pid=%s\n' "$client_b_pid"
    printf 'client_b_pgid=%s\n' "$client_b_pgid"
  } >> "$EVIDENCE_ROOT/owned-pids"
  mark "clients spawned a=$client_a_pid b=$client_b_pid"

  # Wait for both clients to complete, failing closed if the nested crashes.
  while true; do
    if ! "$KILL_BIN" -0 "$client_a_pid" 2>/dev/null && ! "$KILL_BIN" -0 "$client_b_pid" 2>/dev/null; then
      break
    fi
    if ! "$KILL_BIN" -0 "$nested_pid" 2>/dev/null; then
      wait "$nested_pid" 2>/dev/null
      status=$?
      if [[ "$status" -ne 0 ]]; then
        fail "nested compositor exited unexpectedly (status $status)"
      fi
      break
    fi
    "$SLEEP_BIN" 0.1
  done
  wait "$client_a_pid" 2>/dev/null || true
  wait "$client_b_pid" 2>/dev/null || true
  mark "clients exited"
  "$SLEEP_BIN" "$RUNNER_CHECKLIST_WAIT_SECONDS"
  mark "checklist observation wait=${RUNNER_CHECKLIST_WAIT_SECONDS}s"

  # Normal unload and post-unload check.
  if ! effects_request unloadEffect >/dev/null; then
    fail "effect unload failed"
  fi
  if ! loaded="$(effects_request isEffectLoaded)"; then
    fail "could not verify effect unload"
  fi
  if [[ "$loaded" == *true* ]]; then
    fail "effect still loaded after unload"
  fi
  loaded_by_us=0
  mark "effect unloaded"

  # Terminate the owned groups (clients first, then the nested launcher).
  if ! cleanup_owned; then
    fail "owned cleanup verification failed"
  fi
  {
    printf 'checklist: owned-groups-terminated=yes\n'
    printf 'checklist: evidence-retained=yes\n'
  } >> "$EVIDENCE_ROOT/manifest.txt" 2>/dev/null || true

  exit 0
}

run() {
  local quick="${1:-0}" host_socket nested_socket build_dir
  local host_runtime host_display
  local version_line runtime_ver abi_ver plugin_so plugin_suffix plugin_prefix test_root candidate_root
  local repo_root plugin_src kwin_dir
  local outer_xdg_data_dirs_set=0 outer_xdg_data_dirs=""
  local -a plugin_sos
  local inner_session_pid="" inner_runner_pid="" inner_exit=0
  local pending_signal="" pending_code="" published_pid="" validation_attempts=0
  local first_signal="" validated_runner_ever=0
  local i j

  # EVIDENCE_ROOT is internal runner state, never a caller-controlled override.
  # The fake harness may supply a pre-created root only through its explicit
  # gate and only below its marker-verified private root.
  unset EVIDENCE_ROOT
  if [[ -n "${RUNNER_EVIDENCE_OVERRIDE:-}" ]]; then
    if [[ "${RUNNER_TEST_ONLY_EVIDENCE_OVERRIDE:-}" != "1" || -z "${RUNNER_TEST_ROOT:-}" ]]; then
      fail "runner evidence override requires RUNNER_TEST_ONLY_EVIDENCE_OVERRIDE=1"
    fi
    test_root="$(cd -P -- "$RUNNER_TEST_ROOT" 2>/dev/null && pwd)" || fail "invalid harness test root"
    if [[ ! -f "$test_root/.live-native-effect-test-root" ]]; then
      fail "invalid harness test root"
    fi
    candidate_root="$(cd -P -- "$RUNNER_EVIDENCE_OVERRIDE" 2>/dev/null && pwd)" || fail "invalid harness evidence root"
    if [[ "$candidate_root" == "$test_root"/* ]]; then
      EVIDENCE_ROOT="$candidate_root"
    else
      fail "harness evidence root must be under the private test root"
    fi
  fi
  EVIDENCE_ROOT="${EVIDENCE_ROOT:-$(mktemp -d)}"
  printf 'EVIDENCE_ROOT=%s\n' "$EVIDENCE_ROOT" >&2

  # Resolve the repository's exact native plugin source itself, never a
  # harness-injected path or an installed host plugin.
  repo_root="$(cd -- "$(dirname -- "$SELF")/.." && pwd)" || fail "could not resolve repository root"
  plugin_src="$repo_root/kwin/native-effect"
  if [[ ! -d "$plugin_src" || ! -f "$plugin_src/CMakeLists.txt" || ! -f "$plugin_src/metadata.json" || ! -f "$plugin_src/activewindowborder.cpp" ]]; then
    fail "native plugin source missing or incomplete: $plugin_src"
  fi

  resolve_tool KWIN_WAYLAND_BIN kwin_wayland || exit 1
  resolve_tool WESTON_TERMINAL_BIN weston-terminal || exit 1
  resolve_tool DBUS_RUN_BIN dbus-run-session || exit 1
  resolve_tool DBUS_CALL_BIN gdbus || exit 1
  resolve_tool CMAKE_BIN cmake || exit 1
  resolve_tool KILL_BIN kill || exit 1
  resolve_tool SLEEP_BIN sleep || exit 1
  resolve_tool SETSID_BIN setsid || exit 1
  resolve_tool PS_BIN ps || exit 1
  if [[ -z "${JOURNALCTL_BIN:-}" ]]; then
    JOURNALCTL_BIN="$(command -v journalctl 2>/dev/null || true)"
  fi

  # Resolve the absolute host Wayland socket before replacing the runtime dir.
  host_runtime="${XDG_RUNTIME_DIR:-}"
  host_display="${WAYLAND_DISPLAY:-wayland-0}"
  if [[ -z "$host_runtime" ]]; then
    fail "missing XDG_RUNTIME_DIR for host Wayland socket"
  fi
  host_socket="${host_runtime%/}/$host_display"
  case "$host_socket" in
    /*) : ;;
    *) fail "host Wayland socket path is not absolute: $host_socket" ;;
  esac
  if [[ ! -e "$host_socket" ]]; then
    fail "host Wayland socket not found: $host_socket"
  fi
  if [[ ! -S "$host_socket" ]]; then
    # Only the harness's explicit test-only gate may bypass the Unix-socket
    # type. That bypass is accepted only under the master test gate and only
    # when the path is canonically confined beneath the harness's private test
    # root; every other non-socket path fails closed.
    if [[ "${RUNNER_TEST_ONLY_SOCKET_BYPASS:-}" != "1" ]]; then
      fail "host Wayland socket is not a Unix socket: $host_socket"
    fi
    if [[ "${RUNNER_TEST_ONLY_EVIDENCE_OVERRIDE:-}" != "1" || -z "${RUNNER_TEST_ROOT:-}" ]]; then
      fail "runner socket bypass requires RUNNER_TEST_ONLY_EVIDENCE_OVERRIDE=1"
    fi
    socket_test_root="$(cd -P -- "$RUNNER_TEST_ROOT" 2>/dev/null && pwd)" || fail "invalid harness test root"
    if [[ ! -f "$socket_test_root/.live-native-effect-test-root" ]]; then
      fail "invalid harness test root"
    fi
    if [[ -L "$host_socket" ]]; then
      fail "harness socket must not be a symlink"
    fi
    socket_dir="$(cd -P -- "$(dirname -- "$host_socket")" 2>/dev/null && pwd)" || fail "invalid harness socket directory"
    if [[ "$socket_dir/" != "$socket_test_root/"* ]]; then
      fail "harness socket must be under the private test root"
    fi
  fi

  mkdir -p "$EVIDENCE_ROOT"
  local home_dir="$EVIDENCE_ROOT/home"
  local runtime_dir="$EVIDENCE_ROOT/run"
  build_dir="$EVIDENCE_ROOT/build"
  mkdir -p "$home_dir" "$runtime_dir" "$build_dir"
  chmod 0700 "$home_dir" "$runtime_dir"
  mkdir -p "$home_dir/.kde" "$home_dir/.config" "$home_dir/.local/share" \
    "$EVIDENCE_ROOT/cache" "$EVIDENCE_ROOT/state"
  chmod 0700 "$home_dir/.kde" "$home_dir/.config" "$home_dir/.local/share" \
    "$EVIDENCE_ROOT/cache" "$EVIDENCE_ROOT/state"

  : > "$EVIDENCE_ROOT/manifest.txt"
  : > "$EVIDENCE_ROOT/transitions.log"
  {
    printf 'manifest_started=%s\n' "${EPOCHSECONDS:-0}"
    printf 'plugin_id=%s\n' "$PLUGIN_ID"
    printf 'evidence_root=%s\n' "$EVIDENCE_ROOT"
    printf 'kwin_wayland_bin=%s\n' "$KWIN_WAYLAND_BIN"
    printf 'weston_terminal_bin=%s\n' "$WESTON_TERMINAL_BIN"
    printf 'dbus_run_bin=%s\n' "$DBUS_RUN_BIN"
    printf 'dbus_call_bin=%s\n' "$DBUS_CALL_BIN"
    printf 'cmake_bin=%s\n' "$CMAKE_BIN"
    printf 'kill_bin=%s\n' "$KILL_BIN"
    printf 'sleep_bin=%s\n' "$SLEEP_BIN"
    printf 'setsid_bin=%s\n' "$SETSID_BIN"
    printf 'ps_bin=%s\n' "$PS_BIN"
    printf 'journalctl_bin=%s\n' "${JOURNALCTL_BIN:-unavailable}"
    printf 'quick=%s\n' "$quick"
  } >> "$EVIDENCE_ROOT/manifest.txt"

  # Private nested socket name (never the host display).
  nested_socket="wayland-1"

  # Establish the private environment before any build subprocess runs.
  export HOME="$home_dir"
  export KDEHOME="$home_dir/.kde"
  export XDG_CONFIG_HOME="$home_dir/.config"
  export XDG_DATA_HOME="$home_dir/.local/share"
  export XDG_CACHE_HOME="$EVIDENCE_ROOT/cache"
  export XDG_STATE_HOME="$EVIDENCE_ROOT/state"
  export XDG_RUNTIME_DIR="$runtime_dir"
  export WAYLAND_DISPLAY="$nested_socket"
  export KWIN_COMPOSE="O2"
  export RUNNER_HOST_SOCKET="$host_socket"
  export RUNNER_NESTED_SOCKET="$nested_socket"
  export PLUGIN_ID
  export EVIDENCE_ROOT
  export KWIN_WAYLAND_BIN WESTON_TERMINAL_BIN DBUS_RUN_BIN DBUS_CALL_BIN CMAKE_BIN KILL_BIN SLEEP_BIN SETSID_BIN PS_BIN JOURNALCTL_BIN
  if [[ "$quick" -eq 1 ]]; then
    export RUNNER_CHECKLIST_WAIT_SECONDS=0.1
  else
    export RUNNER_CHECKLIST_WAIT_SECONDS=2
  fi

  # Preflight the requested compositor mode before any nested launch. The runner
  # forces OpenGL via its own KWIN_COMPOSE=O2 and records that request here; the
  # actual private renderer state is verified only after launch, never before.
  if [[ "$KWIN_COMPOSE" != "O2" ]]; then
    fail "requested compositor mode is not OpenGL (KWIN_COMPOSE=${KWIN_COMPOSE:-unset})"
  fi
  printf 'preflight: compositor-mode=OpenGL kwin_compose=%s\n' "$KWIN_COMPOSE" >> "$EVIDENCE_ROOT/manifest.txt"
  printf '%s\n' "$KWIN_COMPOSE" > "$EVIDENCE_ROOT/preflight-compositor"

  # ABI/version preflight: exact kwin_wayland --version before any launch.
  if ! "$KWIN_WAYLAND_BIN" --version >"$EVIDENCE_ROOT/kwin-version.log" 2>&1; then
    fail "could not determine kwin_wayland version"
  fi
  version_line="$(<"$EVIDENCE_ROOT/kwin-version.log")"
  runtime_ver="${version_line##* }"
  if [[ -z "$runtime_ver" ]]; then
    fail "could not determine kwin_wayland version"
  fi

  # Private CMake build; the plugin's target ABI comes from the KWin package
  # CMake actually resolves, not a fabricated artifact.
  if ! "$CMAKE_BIN" -S "$plugin_src" -B "$build_dir" >"$EVIDENCE_ROOT/cmake-configure.log" 2>&1; then
    fail "cmake configure failed"
  fi
  kwin_dir="$(sed -n 's/^KWin_DIR:PATH=//p' "$build_dir/CMakeCache.txt" 2>/dev/null | head -n 1)"
  if [[ -z "$kwin_dir" ]]; then
    fail "could not resolve KWin package directory from CMake configure"
  fi
  abi_ver="$(sed -n 's/^set(PACKAGE_VERSION "\([^"]*\)")/\1/p' "$kwin_dir/KWinConfigVersion.cmake" 2>/dev/null | head -n 1)"
  if [[ -z "$abi_ver" ]]; then
    fail "could not determine plugin ABI version"
  fi
  if [[ "$abi_ver" != "$runtime_ver" ]]; then
    fail "ABI/version mismatch: plugin $abi_ver vs kwin_wayland $runtime_ver"
  fi
  if ! "$CMAKE_BIN" --build "$build_dir" >"$EVIDENCE_ROOT/cmake-build.log" 2>&1; then
    fail "plugin build failed"
  fi
  mapfile -t plugin_sos < <(find "$build_dir" -name "$PLUGIN_ID.so" -type f 2>/dev/null)
  if [[ "${#plugin_sos[@]}" -ne 1 ]]; then
    fail "built plugin not uniquely located under build directory (found ${#plugin_sos[@]})"
  fi
  plugin_so="${plugin_sos[0]}"
  plugin_so="$(cd -P -- "$(dirname -- "$plugin_so")" && pwd)/$(basename -- "$plugin_so")" || fail "could not resolve built plugin path"
  plugin_suffix="/kwin/effects/plugins/${PLUGIN_ID}.so"
  if [[ "$plugin_so" != *"$plugin_suffix" ]]; then
    fail "built plugin does not conform to the $plugin_suffix layout: $plugin_so"
  fi
  plugin_prefix="${plugin_so%"$plugin_suffix"}"
  if [[ -z "$plugin_prefix" || "$plugin_prefix" != /* ]]; then
    fail "built plugin search prefix is not absolute: $plugin_prefix"
  fi
  export QT_PLUGIN_PATH="$plugin_prefix"
  printf 'plugin_so=%s\n' "$plugin_so" >> "$EVIDENCE_ROOT/manifest.txt"
  printf 'qt_plugin_path=%s\n' "$plugin_prefix" >> "$EVIDENCE_ROOT/manifest.txt"

  # Capture the exact caller XDG_DATA_DIRS state (unset vs set/value), then hand
  # dbus-run-session a sanitized, deterministic activation-search environment so
  # its daemon does not inherit the oversized Nix/devenv service list. The
  # private session restores the captured state before nested KWin launches.
  outer_xdg_data_dirs_set=0
  if [[ -n "${XDG_DATA_DIRS+x}" ]]; then
    outer_xdg_data_dirs_set=1
    outer_xdg_data_dirs="${XDG_DATA_DIRS}"
  fi
  printf 'xdg_data_dirs_captured_set=%s\n' "$outer_xdg_data_dirs_set" >> "$EVIDENCE_ROOT/manifest.txt"
  printf 'xdg_data_dirs_captured_value=%s\n' "${outer_xdg_data_dirs-}" >> "$EVIDENCE_ROOT/manifest.txt"
  export RUNNER_OUTER_XDG_DATA_DIRS_SET="$outer_xdg_data_dirs_set"
  export RUNNER_OUTER_XDG_DATA_DIRS="${outer_xdg_data_dirs-}"
  export XDG_DATA_DIRS="$XDG_DATA_HOME"

  # Outer foreground wrapper: the private dbus-run-session/dbus-daemon and the
  # inner runner must survive terminal INT/TERM cleanup. The inner runner runs
  # in its own session so a terminal foreground process-group signal never
  # reaches the bus daemon or the inner runner directly. This wrapper alone
  # receives terminal signals and forwards exactly one TERM (the inner runner's
  # INT is ignored by its background launch) to the validated inner-runner PID,
  # then waits for the supervisor to end the private bus.
  inner_mark() {
    printf 'lifecycle: %s\n' "$*" >> "$EVIDENCE_ROOT/manifest.txt" 2>/dev/null || true
  }

  published_inner_runner_pid() {
    local line
    [[ -f "$EVIDENCE_ROOT/inner-identity" ]] || return 1
    while IFS= read -r line; do
      if [[ "$line" == pid=* ]]; then
        printf '%s\n' "${line#pid=}"
        return 0
      fi
    done < "$EVIDENCE_ROOT/inner-identity"
    return 1
  }

  # The inner runner is the direct child of dbus-run-session (the session
  # leader). A PID is valid to signal only when it is numeric, live, distinct
  # from the leader, and its ps-observed parent is the still-live leader.
  validate_inner_runner() {
    local published_pid="$1"
    local inspection="" reported_pid="" reported_ppid="" ps_status=0
    local stdout_file="$EVIDENCE_ROOT/ownership-inner-runner-ps.stdout.log"
    local stderr_file="$EVIDENCE_ROOT/ownership-inner-runner-ps.stderr.log"
    local stderr="" quoted_inspection="" quoted_stderr=""

    if [[ ! "$published_pid" =~ ^[1-9][0-9]*$ ]]; then
      inner_mark "inner runner validation pid=$published_pid result=refused reason=invalid-pid"
      return 1
    fi
    if [[ "$published_pid" == "$inner_session_pid" ]]; then
      inner_mark "inner runner validation pid=$published_pid result=refused reason=is-session-leader leader=$inner_session_pid"
      return 1
    fi
    if ! "$KILL_BIN" -0 -- "$published_pid" 2>/dev/null; then
      inner_mark "inner runner validation pid=$published_pid result=refused reason=not-alive"
      return 1
    fi
    if ! "$KILL_BIN" -0 -- "$inner_session_pid" 2>/dev/null; then
      inner_mark "inner runner validation pid=$published_pid result=refused reason=session-not-alive leader=$inner_session_pid"
      return 1
    fi
    if ! : > "$stdout_file" 2>/dev/null || ! : > "$stderr_file" 2>/dev/null; then
      inner_mark "inner runner validation pid=$published_pid result=refused reason=evidence-preparation-failed"
      return 1
    fi
    "$PS_BIN" -o pid= -o ppid= -p "$published_pid" >"$stdout_file" 2>"$stderr_file"
    ps_status=$?
    inspection="$(<"$stdout_file")"
    IFS= read -r -N 4096 stderr < "$stderr_file" || true
    printf -v quoted_inspection '%q' "$inspection"
    printf -v quoted_stderr '%q' "$stderr"
    inner_mark "inner runner probe pid=$published_pid ps_status=$ps_status stdout_file=$stdout_file stdout=$quoted_inspection stderr_file=$stderr_file stderr=$quoted_stderr"
    if [[ "$ps_status" -ne 0 ]]; then
      inner_mark "inner runner validation pid=$published_pid result=refused reason=ps-failed"
      return 1
    fi
    if [[ ! "$inspection" =~ ^[[:blank:]]*([0-9]+)[[:blank:]]+([0-9]+)[[:blank:]]*$ ]]; then
      inner_mark "inner runner validation pid=$published_pid result=refused reason=unprovable-parent"
      return 1
    fi
    reported_pid="${BASH_REMATCH[1]}"
    reported_ppid="${BASH_REMATCH[2]}"
    if [[ "$reported_pid" != "$published_pid" ]]; then
      inner_mark "inner runner validation pid=$published_pid result=refused reason=pid-mismatch reported_pid=$reported_pid"
      return 1
    fi
    if [[ "$reported_ppid" != "$inner_session_pid" ]]; then
      inner_mark "inner runner validation pid=$published_pid result=refused reason=parent-mismatch reported_ppid=$reported_ppid leader=$inner_session_pid"
      return 1
    fi
    inner_mark "inner runner validation pid=$published_pid result=verified ppid=$reported_ppid"
    return 0
  }

  terminate_inner_session() {
    local j
    # Exact owned-session-group fallback only: never a leader-only or broad
    # group signal. Permitted only while no validated inner-runner PID has
    # ever been established; after a valid app PID is established, a stuck
    # session is recorded as unresolved rather than group-signalled, so the
    # app can never receive a second TERM through its session group.
    if [[ -n "$inner_session_pid" ]] && "$KILL_BIN" -0 -- "$inner_session_pid" 2>/dev/null; then
      if [[ "$validated_runner_ever" -eq 1 ]]; then
        inner_mark "outer terminate result=unresolved reason=validated-inner-runner-established no-group-signal=true pid=$inner_session_pid"
        return 0
      fi
      "$KILL_BIN" -TERM -- "-$inner_session_pid" 2>/dev/null || true
      inner_mark "outer terminate result=owned-session-group-requested pid=$inner_session_pid no-unload=true"
      for ((j = 0; j < 100; j++)); do
        "$KILL_BIN" -0 -- "$inner_session_pid" 2>/dev/null || return 0
        "$SLEEP_BIN" 0.1
      done
    fi
  }

  forward_signal() {
    local signame="$1" code="$2" j
    if [[ -z "$inner_runner_pid" ]]; then
      inner_mark "signal forward result=refused sig=$signame reason=no-validated-inner-runner"
      exit 1
    fi
    if ! "$KILL_BIN" -0 -- "$inner_runner_pid" 2>/dev/null; then
      inner_mark "signal forward result=already-exited sig=$signame pid=$inner_runner_pid"
    elif validate_inner_runner "$inner_runner_pid"; then
      # Both INT and TERM are forwarded as exactly one TERM to the validated
      # PID; the inner runner's INT is ignored by its background launch.
      "$KILL_BIN" -TERM -- "$inner_runner_pid" 2>/dev/null
      inner_mark "signal forward result=sent sig=TERM pid=$inner_runner_pid"
    else
      inner_mark "signal forward result=refused sig=$signame pid=$inner_runner_pid reason=identity-unverified"
      inner_runner_pid=""
      exit 1
    fi
    for ((j = 0; j < 100; j++)); do
      "$KILL_BIN" -0 -- "$inner_session_pid" 2>/dev/null || break
      "$SLEEP_BIN" 0.1
    done
    if "$KILL_BIN" -0 -- "$inner_session_pid" 2>/dev/null; then
      inner_mark "signal forward result=session-exit-timeout sig=$signame"
      inner_mark "signal forward result=failed sig=$signame"
    else
      if wait "$inner_session_pid"; then
        inner_exit=0
      else
        inner_exit=$?
      fi
      inner_mark "inner session exit status=$inner_exit"
    fi
    exit "$code"
  }

  handle_signal() {
    local signame="$1" code="$2"
    if [[ -n "$first_signal" ]]; then
      inner_mark "signal ignored after first sig=$signame first=$first_signal"
      return 0
    fi
    first_signal="$signame"
    if [[ -n "$inner_runner_pid" ]]; then
      forward_signal "$signame" "$code"
    else
      pending_signal="$signame"
      pending_code="$code"
      inner_mark "signal before inner runner publication sig=$signame"
    fi
  }

  trap 'terminate_inner_session' EXIT
  trap 'handle_signal INT 130' INT
  trap 'handle_signal TERM 143' TERM

  # Launch the inner session in its own session, shielded from the terminal's
  # foreground process group. Job control is disabled, so the backgrounded
  # setsid is never a process group leader and $! is exactly the session leader.
  "$SETSID_BIN" "$DBUS_RUN_BIN" -- "$BASH_BIN" "$SELF" __session &
  inner_session_pid=$!
  inner_mark "inner session launched pid=$inner_session_pid"

  # Bounded startup wait: the inner runner publishes its PID, which is
  # validated before any signal is forwarded. A terminal signal arriving
  # before publication is held - preserving the private bus - and forwarded
  # only once a valid PID is published.
  inner_runner_pid=""
  validation_attempts=0
  for ((i = 0; i < 100; i++)); do
    if ! "$KILL_BIN" -0 -- "$inner_session_pid" 2>/dev/null; then
      if wait "$inner_session_pid"; then
        inner_exit=0
      else
        inner_exit=$?
      fi
      fail "inner session exited before inner runner publication (status $inner_exit)"
    fi
    published_pid="$(published_inner_runner_pid)"
    if [[ -n "$published_pid" ]]; then
      if validate_inner_runner "$published_pid"; then
        inner_runner_pid="$published_pid"
        validated_runner_ever=1
        inner_mark "inner runner published pid=$inner_runner_pid"
        break
      fi
      validation_attempts=$((validation_attempts + 1))
      if [[ "$validation_attempts" -ge 10 ]]; then
        fail "invalid inner runner identity publication (pid $published_pid)"
      fi
    fi
    "$SLEEP_BIN" 0.1
  done
  if [[ -z "$inner_runner_pid" ]]; then
    fail "inner runner identity never published"
  fi

  # A signal deferred during startup is forwarded now that the inner runner is
  # validated.
  if [[ -n "$pending_signal" ]]; then
    forward_signal "$pending_signal" "$pending_code"
  fi

  if wait "$inner_session_pid"; then
    inner_exit=0
  else
    inner_exit=$?
  fi
  inner_mark "inner session exit status=$inner_exit"
  inner_runner_pid=""
  inner_session_pid=""
  exit "$inner_exit"
}

quick=0
case "${1:-}" in
  "")
    fail "missing command"
    ;;
  --help|-h|help)
    usage
    exit 0
    ;;
  run)
    shift
    if [[ "$#" -gt 0 ]]; then
      case "$1" in
        --quick)
          quick=1
          shift
          ;;
        *)
          fail "unknown run argument: $1"
          ;;
      esac
    fi
    if [[ "$#" -gt 0 ]]; then
      fail "unknown run argument: $1"
    fi
    run "$quick"
    ;;
  __session)
    __session
    ;;
  *)
    fail "unknown command: $1"
    ;;
esac
