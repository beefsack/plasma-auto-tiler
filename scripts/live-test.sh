#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
KWIN_DIR="$REPO_ROOT/kwin"
BUNDLE="$KWIN_DIR/contents/code/main.js"

PLUGIN_ID="plasma-auto-tiler-kwin"

BUS_SCOPE="--user"
BUS_DEST="org.kde.KWin"

# Sub-scripts and host tools are overridable for hermetic shell tests.
DOGFOOD_SH="${DOGFOOD_SH:-$REPO_ROOT/scripts/dogfood-install.sh}"
START_TEST_SH="${START_TEST_SH:-$REPO_ROOT/scripts/start-test.sh}"
NPM_BIN="${NPM_BIN:-npm}"
BUSCTL_BIN="${BUSCTL_BIN:-busctl}"
JOURNALCTL_BIN="${JOURNALCTL_BIN:-journalctl}"
JQ_BIN="${JQ_BIN:-jq}"
SLEEP_BIN="${SLEEP_BIN:-sleep}"
SHA256SUM_BIN="${SHA256SUM_BIN:-sha256sum}"
STAT_BIN="${STAT_BIN:-stat}"
PROC_ROOT="${PROC_ROOT:-/proc}"

# Lock and nonce-owned evidence live under a base outside the repository
# (never under the protected test-output path). Override for tests.
LIVE_BASE="${LIVE_TEST_ROOT:-${XDG_RUNTIME_DIR:-/tmp}}/plasma-auto-tiler-live"

# Run-owned state.
NONCE=""
EVIDENCE_DIR=""
LOCK_DIR=""
LOCK_PLUGIN_FILE=""
LOCK_ACQUIRED=0
ENABLED_BEFORE=""
INSTALLED_BEFORE=""
RUNNING=0
SIGNAL_RECEIVED=""
VERBOSE=0
KWIN_PID=""
JOURNAL_CURSOR=""
PROVENANCE_PLUGIN_ID=""
PROVENANCE_SCRIPT_ID=""
PROVENANCE_BUILD_ID=""
PROVENANCE_CLEANUP_VERIFIED=0
KWIN_START_IDENTITY=""
BASELINE_DIR=""
BASELINE_INSTALLED_PATH=""
BASELINE_CONFIG_PATH=""
BASELINE_CONFIG_STATE="absent"
BASELINE_LOADED=""
BASELINE_PROVENANCE_LOADED=""
BASELINE_SHORTCUTS=""
BASELINE_KGLOBALACCEL=""
OPERATIONAL_BINDING_READY=0
PROVENANCE_ATTEMPTED=0
PROVENANCE_CLEANUP_LOADED=""
PROVENANCE_SETUP_ACTIVE=0

usage() {
  cat <<'EOF'
usage: live-test.sh <command> [--help]

Interactive manual live-runner for the plasma-auto-tiler-kwin KWin script.

Commands:
  run           concise full preflight (typecheck, build, tests, static
                 scan; one pass/fail line per step, logs retained), then
                 establish and tear down only the inert checkout provenance
                 carrier, proving exact baseline restoration
  run --quick   skip the full test suite but still typecheck, build the
                current bundle, and run the critical static scan
  run --verbose stream each preflight step's output to the terminal while
                 still retaining it in evidence
  --help        show this help and exit

  run mutates live KWin state and still requires explicit authorization under
  docs/live-kwin-testing.md. It never mutates shortcut records, never kills or
  restarts KWin, never creates desktops or windows, and never launches a
  nested compositor. It stops only the exact carrier script it loaded.
  Controller plugin state is observed and verified, never disabled, enabled, or
  reconfigured.

  SIGKILL (-9) cannot be trapped: if this process is killed that way, the
  cleanup trap never runs. If retained evidence contains an exact provenance
  ownership receipt, use scripts/start-test.sh provenance-stop with that
  receipt and script ID. Otherwise carrier cleanup is unverified; do not use a
  plugin-name fallback. Remove a stale lock under $LIVE_BASE only after
  confirming no live run is active. Evidence under $LIVE_BASE is never deleted
  automatically.
EOF
}

fail() {
  echo "error: $1" >&2
  exit 1
}

# Writes or replaces one manifest key/value atomically so the critical run
# states survive external stdout-only redirection. No personal data. Best
# effort: never aborts the run or cleanup.
manifest_write() {
  local key="$1" value="$2"
  [[ -n "${EVIDENCE_DIR:-}" ]] || return 0
  local tmp
  tmp="$(mktemp "${EVIDENCE_DIR}/manifest.XXXXXX")" || return 0
  if [[ -f "$EVIDENCE_DIR/manifest.txt" ]]; then
    grep -v "^${key}:" "$EVIDENCE_DIR/manifest.txt" >> "$tmp" 2>/dev/null || true
  fi
  printf '%s: %s\n' "$key" "$value" >> "$tmp"
  mv -f "$tmp" "$EVIDENCE_DIR/manifest.txt" || rm -f "$tmp"
}

# SIGINT/SIGTERM handler. Records the exact signal for cleanup and, when the
# interruption lands during a start attempt whose outcome is not yet known,
# writes the interrupted-during-start marker into the evidence directory.
trap_signal() {
  local sig="$1" num
  case "$sig" in
    INT) num=2 ;;
    TERM) num=15 ;;
    *) return ;;
  esac
  SIGNAL_RECEIVED="$sig"
  if [[ "$PROVENANCE_SETUP_ACTIVE" -eq 1 ]]; then
    printf 'interrupted-during-start:%s\n' "$sig" >> "$EVIDENCE_DIR/interrupted-during-start.txt"
    echo "interrupted-during-start:$sig" >&2
    return 0
  fi
  if [[ "$PROVENANCE_ATTEMPTED" -eq 1 && "$RUNNING" -eq 0 && -n "${EVIDENCE_DIR:-}" ]]; then
    printf 'interrupted-during-start:%s\n' "$sig" >> "$EVIDENCE_DIR/interrupted-during-start.txt"
    echo "interrupted-during-start:$sig" >&2
  fi
  exit $((128 + num))
}

# Runs one preflight step, retaining its combined output in
# <evidence>/<name>.txt and printing one pass/fail line. On failure prints
# the log path and a bounded tail. In verbose mode the step output is also
# streamed to the terminal.
preflight_step() {
  local name="$1" dir="$2"
  shift 2
  local log="$EVIDENCE_DIR/$name.txt"
  local rc=0
  if [[ "$VERBOSE" -eq 1 ]]; then
    if ( cd "$dir" && "$@" ) 2>&1 | tee "$log"; then
      rc=0
    else
      rc="${PIPESTATUS[0]}"
    fi
  else
    if ( cd "$dir" && "$@" ) >"$log" 2>&1; then
      rc=0
    else
      rc=$?
    fi
  fi
  if [[ "$rc" -eq 0 ]]; then
    echo "preflight: $name pass"
  else
    echo "preflight: $name FAIL (exit $rc); log: $log" >&2
    tail -n 15 "$log" 2>/dev/null | sed 's/^/  /' >&2 || true
    return "$rc"
  fi
}

# One run lock, keyed by a fresh nonce. The lock is a directory created
# atomically with mkdir (so two concurrent runs cannot both acquire it). Any
# existing path at the lock location - a stale file or a directory - is
# refused without deletion; the lock is removed only when its owned nonce is
# proven to match this run.
check_safe_existing_path() {
  local path="$1" current=/ component
  [[ "$path" == /* && "$path" != *'//' && "$path" != *'/../'* && "$path" != */.. && "$path" != */./* && "$path" != */. ]] || return 1
  IFS=/ read -r -a components <<<"${path#/}"
  for component in "${components[@]}"; do
    [[ -n "$component" ]] || continue
    current="${current%/}/$component"
    [[ -d "$current" && ! -L "$current" ]] || return 1
  done
}

acquire_lock() {
  local parent base_parent tmp_nonce
  parent="$(dirname -- "$LIVE_BASE")"
  if [[ "$LIVE_BASE" != /* || "$LIVE_BASE" == *'//' || "$LIVE_BASE" == *'/../'* || "$LIVE_BASE" == */.. || "$LIVE_BASE" == */./* || "$LIVE_BASE" == */. ]]; then
    fail "live-test evidence path is unsafe"
  fi
  base_parent="${LIVE_BASE%/*}"
  [[ -n "$base_parent" ]] || base_parent=/
  if [[ "$parent" != "$base_parent" ]] || ! check_safe_existing_path "$parent"; then
    fail "live-test evidence parent '$parent' does not exist"
  fi
  [[ ! -L "$LIVE_BASE" ]] || fail "live-test evidence base is a symlink"
  if [[ ! -e "$LIVE_BASE" ]]; then
    mkdir "$LIVE_BASE" || fail "could not create live-test base '$LIVE_BASE'"
  fi
  [[ -d "$LIVE_BASE" && ! -L "$LIVE_BASE" ]] || fail "live-test evidence base is not a directory"
  chmod 700 "$LIVE_BASE" || fail "could not secure live-test evidence base"
  LOCK_DIR="$LIVE_BASE/.lock"
  NONCE="live-$(date +%Y%m%dT%H%M%S)-$$-$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
  [[ "$NONCE" =~ ^live-[A-Za-z0-9._-]+$ ]] || fail "could not generate a safe run nonce"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "error: another live-test run appears to hold the lock at '$LOCK_DIR'" >&2
    echo "refusing to run concurrently; the lock is never deleted automatically." >&2
    echo "inspect it and remove it only after confirming no live run is active." >&2
    exit 1
  fi
  LOCK_ACQUIRED=1
  chmod 700 "$LOCK_DIR" || fail "could not secure live-test lock"
  LOCK_PLUGIN_FILE="$LOCK_DIR/plugin-id"
  tmp_nonce="$(mktemp "$LOCK_DIR/nonce.XXXXXX")" || {
    check_no_symlink_path "$LOCK_DIR" && rmdir -- "$LOCK_DIR" 2>/dev/null || true
    fail "could not write the lock nonce"
  }
  printf '%s\n' "$NONCE" > "$tmp_nonce" && check_no_symlink_path "$LOCK_DIR" && mv -f -- "$tmp_nonce" "$LOCK_DIR/nonce" || {
    remove_owned_lock_file "$tmp_nonce" 2>/dev/null || true
    check_no_symlink_path "$LOCK_DIR" && rmdir -- "$LOCK_DIR" 2>/dev/null || true
    fail "could not write the lock nonce"
  }
  EVIDENCE_DIR="$(mktemp -d "$LIVE_BASE/.run.XXXXXX")" || fail "could not create evidence dir"
  chmod 700 "$EVIDENCE_DIR" || fail "could not secure evidence dir"
}

find_kwin_pid() {
  local owner_out owner pid_out pid
  owner_out="$("$BUSCTL_BIN" $BUS_SCOPE --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s "$BUS_DEST")" || return 1
  "$JQ_BIN" -s -e 'length == 1 and (.[0] | ((keys | sort) == ["data","type"]) and (.type == "s") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "string") and ((.data[0] | length) > 0))' <<<"$owner_out" >/dev/null 2>&1 || return 1
  owner="$("$JQ_BIN" -r '.data[0]' <<<"$owner_out")"
  [[ "$owner" =~ ^:[0-9]+\.[0-9]+$ ]] || return 1
  pid_out="$("$BUSCTL_BIN" $BUS_SCOPE --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetConnectionUnixProcessID s "$owner")" || return 1
  "$JQ_BIN" -s -e 'length == 1 and (.[0] | ((keys | sort) == ["data","type"]) and (.type == "u") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "number") and ((.data[0] | floor) == .data[0]) and (.data[0] > 0))' <<<"$pid_out" >/dev/null 2>&1 || return 1
  pid="$("$JQ_BIN" -r '.data[0]' <<<"$pid_out")"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s\n' "$pid"
}

capture_pid_cursor() {
  KWIN_PID="$(find_kwin_pid)" || fail "could not identify one KWin process"
  capture_kwin_start_identity || fail "could not capture KWin PID/start identity"
  local cursor_out
  cursor_out="$("$JOURNALCTL_BIN" --user --quiet --show-cursor -n 1)" || fail "could not capture the journal cursor"
  JOURNAL_CURSOR="${cursor_out##*-- cursor: }"
  if [[ -z "$JOURNAL_CURSOR" || "$JOURNAL_CURSOR" == "$cursor_out" ]]; then
    fail "journal cursor output did not contain an opaque cursor token"
  fi
}

# Critical static scan: shell syntax plus forbidden generated-bundle syntax
# (optional catch binding, optional chaining, ESM, source maps, node imports).
static_scan() {
  local script
  for script in \
    "$REPO_ROOT/scripts/start-test.sh" \
    "$REPO_ROOT/scripts/dogfood-install.sh" \
    "$REPO_ROOT/scripts/live-test.sh" \
    "$REPO_ROOT/scripts/nested-kwin-spike.sh"; do
    bash -n "$script" || return 1
  done
  if grep -nE 'catch[[:space:]]*\{|sourceMappingURL|node:' "$BUNDLE"; then
    echo "error: static scan found a forbidden bundle token" >&2
    return 1
  fi
  if grep -nE '\.flatMap\(|\.flat\(|Object\.fromEntries|\.finally\(|Promise\.(allSettled|any)\(|\.(trimStart|trimEnd|matchAll|replaceAll)\(' "$BUNDLE"; then
    echo "error: static scan found a post-ES2017 built-in in the bundle" >&2
    return 1
  fi
  if grep -nE '\?\.' "$BUNDLE"; then
    echo "error: static scan found optional chaining in the bundle" >&2
    return 1
  fi
  if grep -nE '^[[:space:]]*(import|export)[[:space:]]' "$BUNDLE"; then
    echo "error: static scan found an ESM import/export in the bundle" >&2
    return 1
  fi
  return 0
}

preflight() {
  local mode="$1"
  echo "=== preflight ($mode) ==="
  preflight_step typecheck "$KWIN_DIR" "$NPM_BIN" run typecheck || fail "npm typecheck failed"
  preflight_step build "$KWIN_DIR" "$NPM_BIN" run build || fail "npm build failed"
  if [[ "$mode" != "quick" ]]; then
    preflight_step tests "$KWIN_DIR" "$NPM_BIN" test || fail "npm test failed"
  fi
  preflight_step static-scan . static_scan || fail "critical static scan failed"
  if [[ ! -f "$BUNDLE" ]]; then
    echo "preflight: bundle FAIL; bundle missing at $BUNDLE after build" >&2
    fail "bundle not found after build: $BUNDLE"
  fi
  echo "preflight: bundle pass"
}

# Returns the exact "yes"/"no" enabled value from a dogfood status transcript.
# Fails closed on a missing, duplicated, or non-exact value.
read_enabled_value() {
  local text="$1" line value=""
  while IFS= read -r line; do
    if [[ "$line" == "enabled: "* ]]; then
      [[ -n "$value" ]] && return 1
      value="${line#enabled: }"
      if [[ "$value" != "yes" && "$value" != "no" ]]; then
        return 1
      fi
    fi
  done <<<"$text"
  [[ -n "$value" ]] || return 1
  printf '%s\n' "$value"
}

# dogfood-install.sh reports an installed package as "yes (<exact path>)" and
# an absent package as "no". Accept only those two documented forms.
read_installed_value() {
  local text="$1" line value=""
  while IFS= read -r line; do
    if [[ "$line" == "installed: "* ]]; then
      [[ -n "$value" ]] && return 1
      value="${line#installed: }"
      if [[ "$value" != "no" && ! "$value" =~ ^yes\ \(.+\)$ ]]; then
        return 1
      fi
    fi
  done <<<"$text"
  [[ -n "$value" ]] || return 1
  if [[ "$value" == "no" ]]; then
    printf '%s\n' no
  else
    printf '%s\n' yes
  fi
}

read_installed_path() {
  local text="$1" line value="" path
  while IFS= read -r line; do
    if [[ "$line" == "installed: "* ]]; then
      [[ -z "$value" ]] || return 1
      value="${line#installed: }"
    fi
  done <<<"$text"
  [[ "$value" == no ]] && { printf '\n'; return 0; }
  [[ "$value" =~ ^yes\ \((/.+)\)$ ]] || return 1
  path="${BASH_REMATCH[1]}"
  [[ "$path" != *$'\n'* && "$path" != *$'\r'* ]] || return 1
  printf '%s\n' "$path"
}

read_loaded_value() {
  local text="$1" line value=""
  while IFS= read -r line; do
    if [[ "$line" == "loaded: "* ]]; then
      [[ -z "$value" ]] || return 1
      value="${line#loaded: }"
    fi
  done <<<"$text"
  [[ "$value" == loaded || "$value" == not-loaded ]] || return 1
  printf '%s\n' "$value"
}

check_no_symlink_path() {
  local path="$1" current=/ component
  [[ "$path" == /* && "$path" != *'//'* ]] || return 1
  IFS=/ read -r -a components <<<"${path#/}"
  for component in "${components[@]}"; do
    [[ -n "$component" && "$component" != . && "$component" != .. ]] || return 1
    current="${current%/}/$component"
    [[ ! -L "$current" ]] || return 1
  done
}

lock_file_matches() {
  local path="$1" expected="$2"
  check_no_symlink_path "$path" || return 1
  if [[ ! -e "$path" ]]; then
    return 0
  fi
  [[ -f "$path" && ! -L "$path" ]] || return 1
  [[ "$(<"$path")" == "$expected" ]]
}

remove_owned_lock_file() {
  local path="$1" parent name identity inode
  check_no_symlink_path "$LOCK_DIR" || return 1
  [[ -d "$LOCK_DIR" && ! -L "$LOCK_DIR" ]] || return 1
  check_no_symlink_path "$path" || return 1
  [[ -f "$path" && ! -L "$path" ]] || return 1
  identity="$($STAT_BIN -c '%d:%i' -- "$path")" || return 1
  inode="${identity#*:}"
  parent="${path%/*}"
  name="${path##*/}"
  check_no_symlink_path "$path" || return 1
  [[ "$($STAT_BIN -c '%d:%i' -- "$path")" == "$identity" ]] || return 1
  find -P -- "$parent" -xdev -maxdepth 1 -type f -name "$name" -inum "$inode" -delete || return 1
  [[ ! -e "$path" && ! -L "$path" ]]
}

file_fingerprint() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" ]] || return 1
  local digest metadata
  digest="$($SHA256SUM_BIN "$path" | awk '{print $1}')" || return 1
  metadata="$($STAT_BIN -c '%a:%u:%g:%s:%Y:%y' -- "$path")" || return 1
  [[ "$digest" =~ ^[[:xdigit:]]{64}$ ]] || return 1
  printf '%s\t%s\n' "$digest" "$metadata"
}

directory_fingerprint() {
  local path="$1"
  [[ -d "$path" && ! -L "$path" ]] || return 1
  "$STAT_BIN" -c '%a:%u:%g:%Y:%y' -- "$path"
}

config_fingerprint() {
  local path="$1" digest metadata
  [[ -f "$path" && ! -L "$path" ]] || return 1
  digest="$($SHA256SUM_BIN "$path" | awk '{print $1}')" || return 1
  metadata="$($STAT_BIN -c '%a:%u:%g:%s:%Y:%y' -- "$path")" || return 1
  [[ "$digest" =~ ^[[:xdigit:]]{64}$ ]] || return 1
  printf '%s\t%s\n' "$digest" "$metadata"
}

package_manifest() {
  local root="$1" type member fingerprint rc=0
  fingerprint="$(directory_fingerprint "$root")" || return 1
  printf 'd\t.\t%s\n' "$fingerprint"
  local -a pipeline_status
  if find -P -- "$root" -mindepth 1 -printf '%y\t%P\0' | LC_ALL=C sort -z | (
      while IFS=$'\t' read -r -d '' type member; do
        if [[ "$member" == *$'\n'* || "$member" == *$'\r'* || "$member" == *$'\t'* ]]; then
          rc=1
          break
        fi
        case "$type" in
          d)
            check_no_symlink_path "$root/$member" || { rc=1; break; }
            fingerprint="$(directory_fingerprint "$root/$member")" || { rc=1; break; }
            printf 'd\t%s\t%s\n' "$member" "$fingerprint"
            ;;
          f)
            fingerprint="$(file_fingerprint "$root/$member")" || { rc=1; break; }
            printf 'f\t%s\t%s\n' "$member" "$fingerprint"
            ;;
          *)
            rc=1
            break
            ;;
        esac
      done
      exit "$rc"
    ); then
    pipeline_status=("${PIPESTATUS[@]}")
  else
    pipeline_status=("${PIPESTATUS[@]}")
  fi
  [[ "${pipeline_status[0]}" -eq 0 && "${pipeline_status[1]}" -eq 0 && "${pipeline_status[2]}" -eq 0 ]]
}

capture_package_baseline() {
  local package_path="$1"
  BASELINE_DIR="$EVIDENCE_DIR/baseline"
  mkdir "$BASELINE_DIR" || fail "could not create baseline evidence directory"
  if [[ -z "$package_path" ]]; then
    printf 'absent\n' > "$BASELINE_DIR/package-state"
    return 0
  fi
  check_no_symlink_path "$package_path" || fail "installed package path is missing, unsafe, or symlinked"
  [[ -d "$package_path" && ! -L "$package_path" ]] || fail "installed package path is not a regular directory"
  for member in metadata.json contents/code/main.js contents/config/main.xml contents/ui/config.ui; do
    [[ -f "$package_path/$member" && ! -L "$package_path/$member" ]] || fail "installed package member is missing or symlinked: $member"
  done
  if [[ -n "$(find -P "$package_path" -type l -print -quit)" ]]; then
    fail "installed package contains a symlink"
  fi
  printf 'present\n%s\n' "$package_path" > "$BASELINE_DIR/package-state"
  package_manifest "$package_path" > "$BASELINE_DIR/package-manifest" || fail "could not capture the installed package tree"
}

capture_config_baseline() {
  BASELINE_CONFIG_PATH="${XDG_CONFIG_HOME:-${HOME:?}/.config}/kwinrc"
  check_no_symlink_path "${BASELINE_CONFIG_PATH%/*}" || fail "KWin config directory is unsafe or symlinked"
  [[ ! -L "$BASELINE_CONFIG_PATH" ]] || fail "KWin config path is a symlink"
  if [[ -e "$BASELINE_CONFIG_PATH" ]]; then
    [[ -f "$BASELINE_CONFIG_PATH" ]] || fail "KWin config path is not a regular file"
    BASELINE_CONFIG_STATE=present
    cp -- "$BASELINE_CONFIG_PATH" "$BASELINE_DIR/kwinrc"
    config_fingerprint "$BASELINE_CONFIG_PATH" > "$BASELINE_DIR/kwinrc-fingerprint" || fail "could not fingerprint KWin config"
  else
    BASELINE_CONFIG_STATE=absent
    printf 'absent\n' > "$BASELINE_DIR/kwinrc-fingerprint"
  fi
  manifest_write config-path "$BASELINE_CONFIG_PATH"
  manifest_write config-state "$BASELINE_CONFIG_STATE"
  manifest_write config-fingerprint "$(<"$BASELINE_DIR/kwinrc-fingerprint")"
}

capture_kwin_start_identity() {
  [[ "$KWIN_PID" =~ ^[1-9][0-9]*$ ]] || return 1
  local stat_line stat_pid rest
  stat_line="$(<"$PROC_ROOT/$KWIN_PID/stat")" || return 1
  [[ "$stat_line" != *$'\n'* ]] || return 1
  stat_pid="${stat_line%% *}"
  [[ "$stat_pid" == "$KWIN_PID" ]] || return 1
  rest="${stat_line##*) }"
  [[ "$rest" != "$stat_line" ]] || return 1
  local -a fields=()
  read -r -a fields <<<"$rest"
  [[ "${#fields[@]}" -ge 20 && "${fields[0]:-}" =~ ^[A-Za-z]$ ]] || return 1
  [[ "${fields[19]:-}" =~ ^[1-9][0-9]*$ ]] || return 1
  KWIN_START_IDENTITY="${fields[19]}"
}

capture_shortcut_baseline() {
  local raw
  BASELINE_SHORTCUTS="$BASELINE_DIR/shortcuts-before.json"
  raw="$(bash "$START_TEST_SH" snapshot-shortcuts)" || fail "could not capture exact project shortcut tuples"
  "$JQ_BIN" -e 'type == "array" and all(.[]; type == "array" and length == 8)' <<<"$raw" >/dev/null || fail "project shortcut snapshot is malformed"
  "$JQ_BIN" -c 'sort_by(tojson)' <<<"$raw" > "$BASELINE_SHORTCUTS" || fail "could not retain exact project shortcut tuples"
}

capture_kglobalaccel_baseline() {
  BASELINE_KGLOBALACCEL="$BASELINE_DIR/kglobalaccel-owner.json"
  bash "$START_TEST_SH" snapshot-kglobalaccel > "$BASELINE_KGLOBALACCEL" || fail "could not capture KGlobalAccel service owner identity"
  "$JQ_BIN" -e 'type == "object" and .service == "org.kde.kglobalaccel" and (.owner | type) == "string" and (.pid | type) == "number" and (.uid | type) == "number"' "$BASELINE_KGLOBALACCEL" >/dev/null || fail "KGlobalAccel service owner identity is malformed"
}

capture_baseline() {
  local dogfood_status direct_status
  dogfood_status="$(bash "$DOGFOOD_SH" status)" || fail "dogfood status failed during baseline capture"
  INSTALLED_BEFORE="$(read_installed_value "$dogfood_status")" || fail "dogfood status did not report an exact installed state"
  ENABLED_BEFORE="$(read_enabled_value "$dogfood_status")" || fail "dogfood status did not report an exact 'enabled: yes/no'"
  BASELINE_INSTALLED_PATH="$(read_installed_path "$dogfood_status")" || fail "dogfood status did not report an exact installed path"
  direct_status="$(bash "$START_TEST_SH" status)" || fail "start-test status failed during baseline capture"
  BASELINE_LOADED="$(read_loaded_value "$direct_status")" || {
    fail "direct status does not report an exact controller loaded state"
  }
  capture_package_baseline "$BASELINE_INSTALLED_PATH"
  capture_config_baseline
  capture_shortcut_baseline
  capture_kglobalaccel_baseline
  kwin_identity_unchanged || fail "KWin PID/start identity changed during baseline capture"
  manifest_write installed-before "$INSTALLED_BEFORE"
  manifest_write installed-path-before "${BASELINE_INSTALLED_PATH:-absent}"
  manifest_write enabled-before "$ENABLED_BEFORE"
  manifest_write loaded-before "$BASELINE_LOADED"
  manifest_write kwin-start-identity "$KWIN_START_IDENTITY"
  manifest_write kglobalaccel-owner "$(<"$BASELINE_KGLOBALACCEL")"
}

setup_provenance() {
  PROVENANCE_ATTEMPTED=1
  PROVENANCE_SETUP_ACTIVE=1
  local output line parsed_line receipt_json expected_receipt nonce build pid script_id plugin cleanup_state state baseline_plugin baseline_loaded cleanup_after count=0 baseline_count=0 command_rc=0 expected_build receipt_present=0
  expected_build="checkout-carrier-v1-$($SHA256SUM_BIN "$REPO_ROOT/kwin/src/provenance-entry.ts" | awk '{print $1}')"
  if output="$(PROVENANCE_OWNERSHIP_FILE="$EVIDENCE_DIR/provenance-ownership" bash "$START_TEST_SH" provenance "$NONCE")"; then
    command_rc=0
  else
    command_rc=$?
  fi
  printf '%s\n' "$output" > "$EVIDENCE_DIR/provenance.txt"
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    parsed_line="$line"
    receipt_json=""
    if [[ "$line" == *" receipt="* ]]; then
      receipt_present=1
      parsed_line="${line%% receipt=*}"
      receipt_json="${line:${#parsed_line}+9}"
    fi
    if [[ "$parsed_line" =~ ^provenance:\ (ready|partial)\ nonce=([^[:space:]]+)\ build=(checkout-carrier-v1-[[:xdigit:]]{64})\ pid=([1-9][0-9]*)\ script-id=([0-9]+|unknown)(\ plugin=([A-Za-z0-9][A-Za-z0-9._-]{7,127}))?(\ cleanup=(verified|unverified))?(\ loaded-after=(loaded|not-loaded))?$ ]]; then
      count=$((count + 1))
      state="${BASH_REMATCH[1]}"
      nonce="${BASH_REMATCH[2]}"
      build="${BASH_REMATCH[3]}"
      pid="${BASH_REMATCH[4]}"
      script_id="${BASH_REMATCH[5]}"
      plugin="${BASH_REMATCH[7]:-}"
      cleanup_state="${BASH_REMATCH[9]:-}"
      cleanup_after="${BASH_REMATCH[11]:-}"
      PROVENANCE_SCRIPT_ID=""
      [[ "$script_id" == unknown ]] || PROVENANCE_SCRIPT_ID="$script_id"
      PROVENANCE_PLUGIN_ID="$plugin"
      [[ "$state" != partial || "$receipt_present" -eq 0 ]] || fail "checkout provenance receipt was malformed, extra, or mismatched"
    elif [[ "$line" =~ ^provenance-baseline:\ plugin=([A-Za-z0-9][A-Za-z0-9._-]{7,127})\ loaded=(loaded|not-loaded)$ ]]; then
      [[ -z "$receipt_json" ]] || fail "checkout provenance setup returned an unexpected receipt"
      baseline_count=$((baseline_count + 1))
      baseline_plugin="${BASH_REMATCH[1]}"
      baseline_loaded="${BASH_REMATCH[2]}"
    elif [[ "$line" == "provenance receipt path: "* || "$line" == "provenance-stop command: "* || "$line" == "note: current public KWin APIs provide operational lifecycle binding, not direct evaluated-memory source proof." ]]; then
      continue
    else
      fail "checkout provenance setup returned an unexpected reply"
    fi
  done <<<"$output"
  [[ "$count" -eq 1 && "$nonce" == "$NONCE" && "$pid" == "$KWIN_PID" ]] || fail "checkout provenance setup was not tied to the captured KWin identity"
  [[ "$build" == "$expected_build" ]] || fail "checkout provenance build identity does not match the current source"
  [[ "$plugin" =~ ^plasma-auto-tiler-checkout-provenance-[[:xdigit:]]{32}$ ]] || fail "checkout provenance did not return its unique plugin identity"
  [[ "$baseline_count" -eq 1 && "$baseline_plugin" == "$plugin" && "$baseline_loaded" == not-loaded ]] || fail "checkout provenance baseline was not proven not-loaded"
  if [[ "$script_id" != unknown ]]; then
    [[ "$script_id" -le 2147483647 ]] || fail "checkout provenance returned an invalid script ID"
  fi
    if [[ "$receipt_present" -eq 1 ]]; then
    [[ "$script_id" != unknown ]] || fail "checkout provenance receipt did not contain a returned script ID"
    expected_receipt="$($JQ_BIN -cn --arg nonce "$nonce" --arg build "$build" --arg plugin "$plugin" --argjson script_id "$script_id" --argjson pid "$KWIN_PID" --arg start_identity "$KWIN_START_IDENTITY" '{kind:"provenance",nonce:$nonce,build:$build,plugin:$plugin,script_id:$script_id,pid:$pid,start_identity:$start_identity}')" || fail "checkout provenance receipt could not be constructed"
    [[ "$receipt_json" == "$expected_receipt" ]] || fail "checkout provenance receipt was malformed, extra, or mismatched"
  fi
  [[ "$command_rc" -ne 0 || "$receipt_present" -eq 1 ]] || fail "checkout provenance ready result did not include its inline ownership receipt"
  if [[ "$command_rc" -ne 0 ]]; then
    [[ "$state" == partial && "$cleanup_state" =~ ^(verified|unverified)$ ]] || fail "checkout provenance setup failed without a strict ownership result"
    if [[ "$cleanup_state" == verified ]]; then
      [[ "$cleanup_after" == not-loaded && "$script_id" != unknown ]] || fail "checkout provenance partial cleanup result was not strictly verified"
    fi
  else
    [[ "$state" == ready && -z "$cleanup_state" ]] || fail "checkout provenance setup returned an invalid success result"
  fi
  PROVENANCE_BUILD_ID="$build"
  BASELINE_PROVENANCE_LOADED="$baseline_loaded"
  PROVENANCE_CLEANUP_LOADED="$cleanup_after"
  local plugin_tmp
  plugin_tmp="$(mktemp "$LOCK_DIR/plugin-id.XXXXXX")" || fail "could not retain the provenance plugin identity in the run lock"
  printf '%s\n' "$PROVENANCE_PLUGIN_ID" > "$plugin_tmp" && chmod 600 "$plugin_tmp" && mv -n -- "$plugin_tmp" "$LOCK_PLUGIN_FILE" || {
    rm -f "$plugin_tmp"
    fail "could not retain the provenance plugin identity in the run lock"
  }
  [[ ! -e "$plugin_tmp" && -f "$LOCK_PLUGIN_FILE" && ! -L "$LOCK_PLUGIN_FILE" && "$(<"$LOCK_PLUGIN_FILE")" == "$PROVENANCE_PLUGIN_ID" ]] || fail "provenance plugin identity lock verification failed"
  manifest_write provenance-plugin-id "$PROVENANCE_PLUGIN_ID"
  manifest_write provenance-script-id "$PROVENANCE_SCRIPT_ID"
  manifest_write provenance-build-id "$PROVENANCE_BUILD_ID"
  manifest_write provenance-loaded-before "$BASELINE_PROVENANCE_LOADED"
  manifest_write provenance-cleanup "$cleanup_state"
  [[ -z "$PROVENANCE_CLEANUP_LOADED" ]] || manifest_write provenance-loaded-after "$PROVENANCE_CLEANUP_LOADED"
  kwin_identity_unchanged || fail "KWin PID/start identity changed during provenance setup"
  if [[ "$command_rc" -ne 0 && "$cleanup_state" == verified ]]; then
    PROVENANCE_CLEANUP_VERIFIED=1
  fi
  if [[ "$command_rc" -ne 0 ]]; then
    manifest_write operational-binding not-proven
    fail "checkout provenance setup failed; operational lifecycle binding is not proven"
  fi
  OPERATIONAL_BINDING_READY=1
  PROVENANCE_SETUP_ACTIVE=0
  if [[ -n "$SIGNAL_RECEIVED" ]]; then
    fail "checkout provenance setup was interrupted by $SIGNAL_RECEIVED; readiness is unverified"
  fi
  manifest_write operational-binding proven
  manifest_write future-journey gated-not-attempted
  echo "operational checkout lifecycle binding confirmed: nonce=$NONCE build=$PROVENANCE_BUILD_ID pid=$KWIN_PID script-id=$PROVENANCE_SCRIPT_ID plugin=$PROVENANCE_PLUGIN_ID"
  echo "note: current public KWin APIs provide operational lifecycle binding, not direct evaluated-memory source proof."
}

kwin_identity_unchanged() {
  local expected_pid="${KWIN_PID:-}" expected_start="${KWIN_START_IDENTITY:-}" current_pid current_start
  [[ -n "$expected_pid" && -n "$expected_start" ]] || return 1
  current_pid="$(find_kwin_pid 2>/dev/null || true)"
  [[ "$current_pid" == "$expected_pid" ]] || return 1
  KWIN_PID="$current_pid"
  if ! capture_kwin_start_identity; then
    KWIN_PID="$expected_pid"
    KWIN_START_IDENTITY="$expected_start"
    return 1
  fi
  current_start="$KWIN_START_IDENTITY"
  KWIN_PID="$expected_pid"
  KWIN_START_IDENTITY="$expected_start"
  [[ "$current_start" == "$expected_start" ]]
}

verify_package_baseline() {
  local state current_path
  IFS= read -r state < "$BASELINE_DIR/package-state" || return 1
  [[ "$state" == absent || "$state" == present ]] || return 1
  current_path="$(read_installed_path "$(bash "$DOGFOOD_SH" status 2>/dev/null)")" || return 1
  if [[ "$state" == absent ]]; then
    [[ -z "$current_path" ]] || return 1
    return 0
  fi
  [[ "$current_path" == "$BASELINE_INSTALLED_PATH" ]] || return 1
  check_no_symlink_path "$current_path" || return 1
  [[ -d "$current_path" && ! -L "$current_path" ]] || return 1
  if ! package_manifest "$current_path" | cmp -s "$BASELINE_DIR/package-manifest" -; then
    return 1
  fi
}

verify_config_baseline() {
  if [[ "$BASELINE_CONFIG_STATE" == absent ]]; then
    [[ ! -e "$BASELINE_CONFIG_PATH" && ! -L "$BASELINE_CONFIG_PATH" ]]
    return
  fi
  [[ -f "$BASELINE_CONFIG_PATH" && ! -L "$BASELINE_CONFIG_PATH" ]] || return 1
  cmp -s "$BASELINE_DIR/kwinrc" "$BASELINE_CONFIG_PATH" || return 1
  [[ "$(config_fingerprint "$BASELINE_CONFIG_PATH")" == "$(<"$BASELINE_DIR/kwinrc-fingerprint")" ]]
}

verify_shortcut_baseline() {
  local raw current
  raw="$(bash "$START_TEST_SH" snapshot-shortcuts 2>/dev/null)" || return 1
  current="$(printf '%s\n' "$raw" | "$JQ_BIN" -c 'sort_by(tojson)' 2>/dev/null)" || return 1
  cmp -s "$BASELINE_SHORTCUTS" <(printf '%s\n' "$current")
}

verify_kglobalaccel_baseline() {
  local current
  current="$(bash "$START_TEST_SH" snapshot-kglobalaccel 2>/dev/null)" || return 1
  "$JQ_BIN" -e 'type == "object" and .service == "org.kde.kglobalaccel" and (.owner | type) == "string" and (.pid | type) == "number" and (.uid | type) == "number"' <<<"$current" >/dev/null || return 1
  cmp -s "$BASELINE_KGLOBALACCEL" <(printf '%s\n' "$current")
}

verify_baseline() {
  local status loaded enabled
  status="$(bash "$DOGFOOD_SH" status 2>/dev/null)" || { echo "baseline verification failed: dogfood status" >&2; return 1; }
  enabled="$(read_enabled_value "$status")" || { echo "baseline verification failed: enabled state" >&2; return 1; }
  [[ "$enabled" == "$ENABLED_BEFORE" ]] || { echo "baseline verification failed: enabled state drift" >&2; return 1; }
  loaded="$(read_loaded_value "$(bash "$START_TEST_SH" status 2>/dev/null)")" || { echo "baseline verification failed: loaded state" >&2; return 1; }
  [[ "$loaded" == "$BASELINE_LOADED" ]] || { echo "baseline verification failed: loaded state drift" >&2; return 1; }
  [[ "$BASELINE_PROVENANCE_LOADED" == not-loaded ]] || { echo "baseline verification failed: provenance carrier loaded state" >&2; return 1; }
  [[ "$PROVENANCE_CLEANUP_LOADED" == not-loaded ]] || { echo "baseline verification failed: provenance carrier was not proven unloaded" >&2; return 1; }
  verify_package_baseline || { echo "baseline verification failed: installed package" >&2; return 1; }
  verify_config_baseline || { echo "baseline verification failed: KWin config" >&2; return 1; }
  verify_shortcut_baseline || { echo "baseline verification failed: project shortcuts" >&2; return 1; }
  verify_kglobalaccel_baseline || { echo "baseline verification failed: KGlobalAccel service owner identity" >&2; return 1; }
}

report_status() {
  local name="$1"
  shift
  "$@" 2>&1 | tee "$EVIDENCE_DIR/$name.txt" || true
}

cleanup() {
  local rc=$? restore_status cleanup_failure=0 identity_ok=0 lock_cleanup_ok
  trap - EXIT INT TERM
  if [[ -z "${KWIN_PID:-}" || -z "${KWIN_START_IDENTITY:-}" ]]; then
    echo "error: KWin identity unavailable; refusing stale-handle cleanup" >&2
    cleanup_failure=1
  elif kwin_identity_unchanged; then
    identity_ok=1
  else
    echo "error: KWin PID/start identity changed; refusing stale-handle cleanup" >&2
    cleanup_failure=1
  fi
  if [[ -n "$PROVENANCE_SCRIPT_ID" && "$PROVENANCE_CLEANUP_VERIFIED" -eq 1 && "$identity_ok" -eq 1 ]]; then
    manifest_write cleanup-provenance verified
  elif [[ -n "$PROVENANCE_SCRIPT_ID" && "$identity_ok" -eq 1 ]]; then
    echo "=== final: stopping the exact checkout provenance carrier ==="
    if PROVENANCE_OWNERSHIP_FILE="$EVIDENCE_DIR/provenance-ownership" bash "$START_TEST_SH" provenance-stop "$PROVENANCE_SCRIPT_ID" >"${EVIDENCE_DIR:-}/final-provenance-stop.txt" 2>&1 && \
      grep -Fqx "provenance-stop: script-id=$PROVENANCE_SCRIPT_ID plugin=$PROVENANCE_PLUGIN_ID unloaded and verified loaded-after=not-loaded" "$EVIDENCE_DIR/final-provenance-stop.txt"; then
      PROVENANCE_CLEANUP_LOADED=not-loaded
      manifest_write cleanup-provenance verified
      manifest_write provenance-loaded-after "$PROVENANCE_CLEANUP_LOADED"
    else
      echo "error: provenance carrier teardown was not verified" >&2
      manifest_write cleanup-provenance unverified
      cleanup_failure=1
    fi
  elif [[ -n "$PROVENANCE_SCRIPT_ID" ]]; then
    manifest_write cleanup-provenance unverified
    cleanup_failure=1
  elif [[ "$PROVENANCE_ATTEMPTED" -eq 1 ]]; then
    manifest_write cleanup-provenance unverified
    cleanup_failure=1
  fi
  manifest_write cleanup-restore not-needed
  if [[ "$identity_ok" -eq 1 ]] && ! kwin_identity_unchanged; then
    echo "error: KWin PID/start identity changed during cleanup" >&2
    identity_ok=0
    cleanup_failure=1
  fi
  if [[ -n "${EVIDENCE_DIR:-}" && "$identity_ok" -eq 1 ]]; then
    echo "=== final status/diagnostics/desktops ==="
    report_status final-status bash "$START_TEST_SH" status
    report_status final-diagnostics bash "$START_TEST_SH" diagnostics
    report_status final-desktops bash "$START_TEST_SH" desktops
    echo "evidence retained at: $EVIDENCE_DIR"
  fi
  if [[ "$identity_ok" -eq 1 ]] && ! verify_baseline; then
    echo "error: exact baseline restoration was not verified" >&2
    manifest_write baseline-restore unverified
    cleanup_failure=1
  elif [[ "$identity_ok" -eq 1 ]] && ! kwin_identity_unchanged; then
    echo "error: KWin PID/start identity changed after baseline verification" >&2
    manifest_write baseline-restore unverified
    cleanup_failure=1
  elif [[ "$identity_ok" -eq 1 ]]; then
    echo "exact project baseline restoration verified"
    manifest_write baseline-restore verified
  else
    echo "error: exact baseline restoration was not verified" >&2
    manifest_write baseline-restore unverified
    cleanup_failure=1
  fi
  if [[ -n "$SIGNAL_RECEIVED" && "$PROVENANCE_ATTEMPTED" -eq 1 && "$RUNNING" -eq 0 ]]; then
    echo "=== setup outcome: unknown/interrupted during provenance setup (${SIGNAL_RECEIVED}); not a readiness verdict ==="
  fi
  manifest_write lock-removed no
  if [[ "$LOCK_ACQUIRED" -eq 1 ]]; then
    if [[ -z "${LOCK_DIR:-}" || ! -d "$LOCK_DIR" || -L "$LOCK_DIR" ]]; then
      echo "error: refusing lock cleanup because the owned lock path changed or is unsafe" >&2
      cleanup_failure=1
    elif ! lock_file_matches "$LOCK_DIR/nonce" "${NONCE:-}"; then
      echo "error: refusing lock cleanup because the owned lock path changed or is unsafe" >&2
      cleanup_failure=1
    elif [[ -n "${LOCK_PLUGIN_FILE:-}" ]] && ! lock_file_matches "$LOCK_PLUGIN_FILE" "${PROVENANCE_PLUGIN_ID:-}"; then
      echo "error: refusing lock cleanup because the owned lock path changed or is unsafe" >&2
      cleanup_failure=1
    else
    lock_cleanup_ok=1
    [[ -z "${LOCK_PLUGIN_FILE:-}" || ! -e "$LOCK_PLUGIN_FILE" ]] || remove_owned_lock_file "$LOCK_PLUGIN_FILE" || lock_cleanup_ok=0
    [[ "$lock_cleanup_ok" -eq 0 || ! -e "$LOCK_DIR/nonce" ]] || remove_owned_lock_file "$LOCK_DIR/nonce" || lock_cleanup_ok=0
    if [[ "$lock_cleanup_ok" -eq 1 ]] && check_no_symlink_path "$LOCK_DIR" && rmdir -- "$LOCK_DIR" 2>/dev/null; then
      manifest_write lock-removed yes
    else
      echo "error: refusing lock cleanup because the owned lock path changed or is unsafe" >&2
      cleanup_failure=1
    fi
    fi
  fi
  [[ "$cleanup_failure" -eq 0 ]] || rc=1
  exit "$rc"
}

cmd_run() {
  local mode="$1"
  acquire_lock
  echo "=== live-test run $NONCE ==="
  echo "evidence: $EVIDENCE_DIR"
  manifest_write nonce "$NONCE"
  manifest_write evidence-dir "$EVIDENCE_DIR"
  manifest_write mode "$mode"

  preflight "$mode"

  # Capture the complete exact baseline before changing the installed-plugin
  # enable state or loading the setup carrier.
  capture_pid_cursor
  capture_baseline
  local dogfood_status
  dogfood_status="$(bash "$DOGFOOD_SH" status)" || fail "dogfood status failed"
  echo "=== installed-plugin state (read-only) ==="
  echo "$dogfood_status"

  echo "=== pre-carrier controller load-state status (read-only) ==="
  echo "$BASELINE_LOADED"

  echo "kwin pid: $KWIN_PID"
  manifest_write kwin-pid "$KWIN_PID"
  manifest_write journal-cursor "$JOURNAL_CURSOR"

  setup_provenance
  if [[ "$OPERATIONAL_BINDING_READY" -ne 1 ]]; then
    fail "operational checkout lifecycle binding was not established"
  fi
  echo "=== checklist ==="
  echo "- inert checkout provenance carrier loaded and bound to the captured KWin identity"
  echo "- future Custom Tile journey: explicitly gated and not attempted"
  echo "- carrier teardown and exact baseline restoration are verified during cleanup"
  echo "- evidence directory: $EVIDENCE_DIR"
  echo "=== live-test provenance setup complete; restore phase follows ==="
}

if [[ $# -eq 0 ]]; then
  echo "error: missing command (run)" >&2
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
  run)
    if [[ $# -gt 3 ]]; then
      echo "error: 'run' takes at most two arguments (--quick, --verbose)" >&2
      exit 1
    fi
    RUN_QUICK=0
    VERBOSE=0
    for RUN_ARG in "${@:2}"; do
      case "$RUN_ARG" in
        --quick) RUN_QUICK=1 ;;
        --verbose) VERBOSE=1 ;;
        *)
          echo "error: unknown run argument '$RUN_ARG' (expected --quick and/or --verbose)" >&2
          exit 1
          ;;
      esac
    done
    mode="full"
    if [[ "$RUN_QUICK" -eq 1 ]]; then
      mode="quick"
    fi
    trap cleanup EXIT
    trap 'trap_signal INT' INT
    trap 'trap_signal TERM' TERM
    cmd_run "$mode"
    ;;
  *)
    echo "error: unknown command '$1'" >&2
    usage >&2
    exit 1
    ;;
esac
