#!/usr/bin/env bash
# POC3 read-only nested ID/eligibility probe lifecycle (dedicated, bounded).
#
# Nested-only and disabled by default (set POC3_ID_PROBE_NESTED_ALLOW=1 to
# enable). Validates the exact WORKDIR manifest plus the manifest private
# bus address/file and private log before loading a separate read-only probe
# bundle, waits boundedly for its `poc3-id-probe-done:<nonce>` diagnostic in
# the private log only, and leaves exact-ID removal to a later cleanup step.
#
# Subcommands (all nested-only):
#   nested WORKDIR probe --owner O --generation G --nonce N
#     build/load/run the separate probe bundle; print its exact signed script
#     id and the exact later cleanup command. Does not unload.
#   nested WORKDIR cleanup <script-id>
#     stop and unload only the exact probe script id, verified not-loaded.
#
# The probe bundle is read-only: it reports exactly three eligible
# Wayland-native normal untiled resizable closeable windows on one
# output/current workspace with opaque String(Window.internalId) values plus
# owner/generation/expected_revision material. It emits only the private log
# (never the host journal) and performs no geometry/focus/close/config/plugin
# actuation. Coexistence guard refuses while production is loaded.
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
KWIN_DIR="$REPO_ROOT/kwin"
BUILD_HELPER="$REPO_ROOT/scripts/poc3-build-id-probe.mjs"
BUNDLE="$KWIN_DIR/dist/poc3-id-probe.js"
PLUGIN="poc3-id-probe"
PRODUCTION_PLUGIN="plasma-auto-tiler-kwin"
: "${NESTED_MANIFEST_SH:=$REPO_ROOT/scripts/nested-kwin-manifest.sh}"
: "${NESTED_MANUAL_SH:=$REPO_ROOT/scripts/nested-manual-clients.sh}"
: "${POC3_ID_PROBE_NESTED_ALLOW:=0}"
: "${PROC_ROOT:=/proc}"
: "${STAT_BIN:=stat}"
: "${SHA256SUM_BIN:=sha256sum}"
: "${KILL_BIN:=kill}"
: "${READLINK_BIN:=readlink}"
: "${BUSCTL_BIN:=busctl}"
: "${JQ_BIN:=jq}"
: "${NODE_BIN:=node}"
: "${GREP_BIN:=grep}"
: "${TAIL_BIN:=tail}"
: "${WC_BIN:=wc}"
: "${SLEEP_BIN:=sleep}"
: "${HEAD_BIN:=head}"
: "${AWK_BIN:=awk}"
: "${MKDIR_BIN:=mkdir}"
: "${RMDIR_BIN:=rmdir}"
: "${MKTEMP_BIN:=mktemp}"
: "${CP_BIN:=cp}"
: "${MV_BIN:=mv}"
: "${RM_BIN:=rm}"
: "${CAT_BIN:=cat}"
: "${DIRNAME_BIN:=dirname}"
: "${SPAWN_SH:=${BASH:-}}"
: "${NESTED_KWIN_TEST_ALLOW_NONSTORE:=0}"

BUS_DEST="org.kde.KWin"
BUS_PATH="/Scripting"
BUS_SCRIPTING_IFACE="org.kde.kwin.Scripting"
BUS_SCRIPT_IFACE="org.kde.kwin.Script"

SCRIPT_ID=""
KWIN_PID=""

READINESS_ATTEMPTS=150
READINESS_DELAY=0.1

isloaded_valid='((keys | sort) == ["data","type"]) and (.type == "b") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "boolean")'
load_valid='((keys | sort) == ["data","type"]) and (.type == "i") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "number") and ((.data[0] | floor) == .data[0]) and ((.data[0] >= 0) and (.data[0] <= 2147483647))'
script_iface_valid='type == "array" and any(.[]; ((.type == "interface") and (.name == "org.kde.kwin.Script")))'
unload_valid="$isloaded_valid"
dbus_string_valid='((keys | sort) == ["data","type"]) and (.type == "s") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "string") and ((.data[0] | length) > 0)'
dbus_pid_valid='((keys | sort) == ["data","type"]) and (.type == "u") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "number") and ((.data[0] | floor) == .data[0]) and ((.data[0] | tostring | test("^[1-9][0-9]*$"))) and (.data[0] > 0) and (.data[0] <= 4294967295)'

usage() {
  cat <<'EOF'
usage: poc3-id-probe.sh nested WORKDIR <probe|cleanup> [args] [--help]

Nested-only read-only POC3 ID/eligibility probe lifecycle.

  nested WORKDIR probe --owner O --generation G --nonce N
    validate WORKDIR/manifest first, use only the manifest private bus
    address and recorded log, re-validate private state again before
    transport, then build/load/run the separate probe bundle and wait
    boundedly for poc3-id-probe-done:<nonce> in the private log. Prints the
    exact signed script id; removal happens in cleanup later.
  nested WORKDIR cleanup <script-id>
    validate WORKDIR/manifest first, then stop/unload only the exact probe
    script id and verify not-loaded.
  --help  show this help and exit

Disabled by default: set POC3_ID_PROBE_NESTED_ALLOW=1 to enable.
Fixed plugin id poc3-id-probe and fixed dist bundle path only.
Refuses while production plugin plasma-auto-tiler-kwin is loaded.
Probe emits only the private log; never the host journal.
Loading/running still requires explicit authorization.
EOF
}

strict_json_matches() {
  local predicate="$1" value="$2"
  "$JQ_BIN" -s -e "length == 1 and (.[0] | $predicate)" <<<"$value" >/dev/null 2>&1
}

store_readlink_bin() {
  local cand="${READLINK_BIN:-}"
  if [[ "$cand" == */* ]]; then
    case "$cand" in /nix/store/*) ;; *) return 1 ;; esac
    [[ "${cand##*/}" == "readlink" ]] || return 1
    [[ -x "$cand" && ! -d "$cand" ]] || return 1
    [[ -f "$cand" && -r "$cand" ]] || return 1
    # Applet layout (e.g. .../bin/readlink -> coreutils): self-canonicalize
    # and require a regular executable /nix/store final before trusting this
    # path as the canonicalizer. Loops, dangling, and non-store finals fail.
    local _final=""
    _final="$("$cand" -f -- "$cand" 2>/dev/null)" || return 1
    case "$_final" in /nix/store/*) ;; *) return 1 ;; esac
    [[ -f "$_final" && ! -L "$_final" && -x "$_final" && -r "$_final" ]] || return 1
    printf '%s' "$cand"
    return 0
  fi
  cand="$(type -P readlink 2>/dev/null)" || return 1
  case "$cand" in /nix/store/*) ;; *) return 1 ;; esac
  [[ "${cand##*/}" == "readlink" ]] || return 1
  [[ -x "$cand" && ! -d "$cand" ]] || return 1
  [[ -f "$cand" && -r "$cand" ]] || return 1
  local _final=""
  _final="$("$cand" -f -- "$cand" 2>/dev/null)" || return 1
  case "$_final" in /nix/store/*) ;; *) return 1 ;; esac
  [[ -f "$_final" && ! -L "$_final" && -x "$_final" && -r "$_final" ]] || return 1
  printf '%s' "$cand"
}

resolve_store_tool() {
  local configured="$1" expected="$2"
  [[ -n "$configured" ]] || { echo "error: required tool is missing: $expected" >&2; return 1; }
  local bin="$configured"
  if [[ "$bin" != */* ]]; then
    bin="$(type -P "$bin" 2>/dev/null)" || { echo "error: required tool is missing: $configured" >&2; return 1; }
  fi
  nested_safe_abs "$bin" || { echo "error: required tool is missing or unsafe ($expected not absolute safe): $bin" >&2; return 1; }
  [[ -x "$bin" && ! -d "$bin" ]] || { echo "error: required tool is missing: $bin" >&2; return 1; }
  [[ "${bin##*/}" == "$expected" ]] || { echo "error: required tool is missing or unsafe ($bin must be $expected)" >&2; return 1; }
  case "$bin" in
    /bin/*|/usr/bin/*) { echo "error: required tool is missing or unsafe ($expected must be exact Nix/devenv executable, not FHS): $bin" >&2; return 1; } ;;
  esac
  if [[ "${NESTED_KWIN_TEST_ALLOW_NONSTORE:-0}" == 1 ]]; then
    case "$bin" in
      /nix/store/*) ;;
      *) printf '%s' "$bin"; return 0 ;;
    esac
  fi
  # Pinned canonicalization: the caller may be a symlink chain (including a
  # Nix per-user profile symlink); validation pins a validated store
  # executable and execution uses only that pinned path. readlink -f failure
  # rejects symlink loops, deleted targets, replacement, and unreadable
  # files. Only a regular executable /nix/store final is trusted (no broad
  # profile/path allowlisting). When the canonical final itself carries the
  # expected basename it is the pinned path; otherwise see the multicall
  # applet rule below (the pinned path is then the validated same-directory
  # store applet caller, never the unvalidated input).
  local canon_rl="" canon=""
  canon_rl="$(store_readlink_bin 2>/dev/null)" || { echo "error: required tool is missing or unsafe ($expected must be exact Nix/devenv executable): $bin" >&2; return 1; }
  case "$canon_rl" in /nix/store/*) ;; *) { echo "error: required tool is missing or unsafe ($expected must be exact Nix/devenv executable): $bin" >&2; return 1; } ;; esac
  [[ -x "$canon_rl" && ! -d "$canon_rl" ]] || { echo "error: required tool is missing or unsafe ($expected must be exact Nix/devenv executable): $bin" >&2; return 1; }
  canon="$("$canon_rl" -f -- "$bin" 2>/dev/null)" || { echo "error: required tool is missing or unsafe ($expected does not resolve to a final executable; symlink loop, replacement, or unreadable file suspected): $bin" >&2; return 1; }
  nested_safe_abs "$canon" || { echo "error: required tool is missing or unsafe ($expected canonical is unsafe): $bin" >&2; return 1; }
  case "$canon" in
    /nix/store/*) ;;
    *) { echo "error: required tool is missing or unsafe ($expected must be exact Nix/devenv executable): $bin" >&2; return 1; } ;;
  esac
  [[ -f "$canon" && ! -L "$canon" ]] || { echo "error: required tool is missing or unsafe ($expected final target is not a regular file): $bin" >&2; return 1; }
  [[ -x "$canon" && -r "$canon" ]] || { echo "error: required tool is missing: $canon" >&2; return 1; }
  if [[ "${canon##*/}" == "$expected" ]]; then
    printf '%s' "$canon"
    return 0
  fi
  # Multicall applet dispatch (e.g. coreutils, gawk): the resolved final is
  # the package multicall binary while authority is the caller applet name.
  # When the caller is already an immutable /nix/store applet path with the
  # expected basename in the same directory as the validated regular
  # non-symlink final, execute via the store applet path (preserves argv[0]
  # dispatch; store immutability keeps validation-to-execution TOCTOU-safe).
  # The applet caller path itself is verified readable/executable with an
  # existing final target; it is not claimed to be the canonical regular
  # file (only the final is). Anything else fails closed.
  case "$bin" in
    /nix/store/*) ;;
    *) { echo "error: required tool is missing or unsafe ($canon must be $expected)" >&2; return 1; } ;;
  esac
  [[ "${bin##*/}" == "$expected" ]] || { echo "error: required tool is missing or unsafe ($canon must be $expected)" >&2; return 1; }
  [[ "${bin%/*}" == "${canon%/*}" ]] || { echo "error: required tool is missing or unsafe ($canon must be $expected)" >&2; return 1; }
  [[ -f "$bin" && -r "$bin" && -x "$bin" ]] || { echo "error: required tool is missing or unsafe ($bin applet path is not a readable executable with an existing final target)" >&2; return 1; }
  printf '%s' "$bin"
}

resolve_stat_bin() { resolve_store_tool "${STAT_BIN:-}" "stat"; }
resolve_sha256sum_bin() { resolve_store_tool "${SHA256SUM_BIN:-}" "sha256sum"; }
resolve_kill_bin() { resolve_store_tool "${KILL_BIN:-}" "kill"; }
resolve_readlink_bin() { resolve_store_tool "${READLINK_BIN:-}" "readlink"; }
resolve_busctl_bin() { resolve_store_tool "${BUSCTL_BIN:-}" "busctl"; }
resolve_jq_bin() { resolve_store_tool "${JQ_BIN:-}" "jq"; }
resolve_node_bin() { resolve_store_tool "${NODE_BIN:-}" "node"; }
resolve_grep_bin() { resolve_store_tool "${GREP_BIN:-}" "grep"; }
resolve_tail_bin() { resolve_store_tool "${TAIL_BIN:-}" "tail"; }
resolve_wc_bin() { resolve_store_tool "${WC_BIN:-}" "wc"; }
resolve_sleep_bin() { resolve_store_tool "${SLEEP_BIN:-}" "sleep"; }
resolve_head_bin() { resolve_store_tool "${HEAD_BIN:-}" "head"; }
resolve_awk_bin() { resolve_store_tool "${AWK_BIN:-}" "awk"; }
resolve_mkdir_bin() { resolve_store_tool "${MKDIR_BIN:-}" "mkdir"; }
resolve_rmdir_bin() { resolve_store_tool "${RMDIR_BIN:-}" "rmdir"; }
resolve_mktemp_bin() { resolve_store_tool "${MKTEMP_BIN:-}" "mktemp"; }
resolve_cp_bin() { resolve_store_tool "${CP_BIN:-}" "cp"; }
resolve_mv_bin() { resolve_store_tool "${MV_BIN:-}" "mv"; }
resolve_rm_bin() { resolve_store_tool "${RM_BIN:-}" "rm"; }
resolve_cat_bin() { resolve_store_tool "${CAT_BIN:-}" "cat"; }
resolve_dirname_bin() { resolve_store_tool "${DIRNAME_BIN:-}" "dirname"; }

# Pinned jq pre-transport execution proof: the input JQ_BIN may be a symlink
# chain (including a Nix per-user profile symlink); only the pinned canonical
# regular exact /nix/store final is executed, never the input symlink. Runs
# once on fixed input before any transport; safe with synthetic fixtures (no
# bus, no mutation). Fails closed. The test hook
# NESTED_KWIN_TEST_ALLOW_NONSTORE=1 preserves existing non-store fixtures by
# proving execution via the pinned variable without store enforcement;
# production (hook=0) enforces the exact regular store final (no broad
# profile/path allowlisting).
pinned_jq_pretransport_check() {
  [[ -n "${JQ_BIN:-}" ]] || { echo "error: pinned jq is unavailable" >&2; return 1; }
  if [[ "${NESTED_KWIN_TEST_ALLOW_NONSTORE:-0}" == 1 ]]; then
    case "$JQ_BIN" in
      /nix/store/*) ;;
      *)
        local _test_out=""
        _test_out="$(printf '{"probe":"ready"}' | "$JQ_BIN" -e '.probe == "ready"' 2>/dev/null)" || { echo "error: pinned jq execution failed: $JQ_BIN" >&2; return 1; }
        [[ "$_test_out" == "true" ]] || { echo "error: pinned jq execution mismatch: $JQ_BIN" >&2; return 1; }
        return 0
        ;;
    esac
  fi
  case "$JQ_BIN" in
    /nix/store/*) ;;
    *) { echo "error: pinned jq must be the exact Nix/devenv executable (profile symlink must never execute): $JQ_BIN" >&2; return 1; } ;;
  esac
  [[ "${JQ_BIN##*/}" == "jq" ]] || { echo "error: pinned jq must be jq: $JQ_BIN" >&2; return 1; }
  [[ -f "$JQ_BIN" && ! -L "$JQ_BIN" ]] || { echo "error: pinned jq final target is not a regular file (profile symlink must never execute): $JQ_BIN" >&2; return 1; }
  [[ -x "$JQ_BIN" && -r "$JQ_BIN" ]] || { echo "error: pinned jq is missing: $JQ_BIN" >&2; return 1; }
  local _out=""
  _out="$(printf '{"probe":"ready"}' | "$JQ_BIN" -e '.probe == "ready"' 2>/dev/null)" || { echo "error: pinned jq execution failed: $JQ_BIN" >&2; return 1; }
  [[ "$_out" == "true" ]] || { echo "error: pinned jq execution mismatch: $JQ_BIN" >&2; return 1; }
}

resolve_spawn_shell() {
  local current="${BASH:-}"
  [[ -n "$current" ]] || { echo "error: spawn shell is unavailable (no FHS fallback)" >&2; return 1; }
  nested_safe_abs "$current" || { echo "error: spawn shell is not an absolute safe path: $current" >&2; return 1; }
  [[ "$current" != /bin/bash ]] || { echo "error: spawn shell must be the exact Nix/devenv Bash, not FHS Bash: $current" >&2; return 1; }
  case "$current" in
    /nix/store/*) ;;
    *) { echo "error: spawn shell must be the exact current Nix/devenv Bash: $current" >&2; return 1; } ;;
  esac
  [[ -x "$current" && ! -d "$current" ]] || { echo "error: spawn shell is missing or not executable: $current" >&2; return 1; }
  # Pin the fully resolved Bash executable: readlink -f failure rejects
  # symlink loops, replacement, and unreadable files; only a regular
  # executable /nix/store Bash final is trusted. Callers must execute the
  # returned pinned path.
  local _rl="" _canon=""
  _rl="$(store_readlink_bin 2>/dev/null)" || { echo "error: spawn shell must be the exact current Nix/devenv Bash: $current" >&2; return 1; }
  case "$_rl" in /nix/store/*) ;; *) { echo "error: spawn shell must be the exact current Nix/devenv Bash: $current" >&2; return 1; } ;; esac
  _canon="$("$_rl" -f -- "$current" 2>/dev/null)" || { echo "error: spawn shell does not resolve to a final executable (symlink loop, replacement, or unreadable file suspected): $current" >&2; return 1; }
  nested_safe_abs "$_canon" || { echo "error: spawn shell must be the exact current Nix/devenv Bash: $current" >&2; return 1; }
  case "$_canon" in
    /nix/store/*) ;;
    *) { echo "error: spawn shell must be the exact current Nix/devenv Bash: $current" >&2; return 1; } ;;
  esac
  [[ -f "$_canon" && ! -L "$_canon" && -x "$_canon" && -r "$_canon" ]] || { echo "error: spawn shell is missing or not executable: $current" >&2; return 1; }
  [[ "${_canon##*/}" == "bash" ]] || { echo "error: spawn shell must be the exact current Nix/devenv Bash: $current" >&2; return 1; }
  if [[ -n "${SPAWN_SH:-}" ]]; then
    local _override_canon=""
    _override_canon="$("$_rl" -f -- "$SPAWN_SH" 2>/dev/null)" || { echo "error: spawn shell override does not match the exact current Nix/devenv Bash (no implicit fallback): $SPAWN_SH" >&2; return 1; }
    [[ "$_override_canon" == "$_canon" ]] || { echo "error: spawn shell override does not match the exact current Nix/devenv Bash (no implicit fallback): $SPAWN_SH" >&2; return 1; }
  fi
  printf '%s' "$_canon"
}

resolve_manifest_sh() {
  local expected="$REPO_ROOT/scripts/nested-kwin-manifest.sh"
  local helper="${NESTED_MANIFEST_SH:-}"
  [[ -n "$helper" ]] || { echo "error: nested manifest helper is unavailable" >&2; return 1; }
  [[ "$helper" == "$expected" ]] || { echo "error: nested manifest helper override is rejected (expected $expected): $helper" >&2; return 1; }
  [[ -f "$helper" && ! -L "$helper" ]] || { echo "error: nested manifest helper is unavailable" >&2; return 1; }
  printf '%s' "$helper"
}

resolve_manual_sh() {
  local expected="$REPO_ROOT/scripts/nested-manual-clients.sh"
  local helper="${NESTED_MANUAL_SH:-}"
  [[ -n "$helper" ]] || { echo "error: nested manual helper is unavailable" >&2; return 1; }
  [[ "$helper" == "$expected" ]] || { echo "error: nested manual helper override is rejected (expected $expected): $helper" >&2; return 1; }
  [[ -f "$helper" && ! -L "$helper" ]] || { echo "error: nested manual helper is unavailable" >&2; return 1; }
  printf '%s' "$helper"
}

require_proc_root() {
  local root="${PROC_ROOT:-/proc}"
  if [[ "$root" != /proc ]]; then
    [[ "${NESTED_KWIN_TEST_ALLOW_NONSTORE:-0}" == 1 ]] || { echo "error: PROC_ROOT must be /proc in production (found $root)" >&2; return 1; }
    nested_safe_abs "$root" || { echo "error: PROC_ROOT is unsafe: $root" >&2; return 1; }
  fi
}

valid_owner() { [[ "$1" =~ ^[A-Za-z0-9._-]{1,128}$ ]]; }
valid_token() { [[ "$1" =~ ^[a-z0-9-]{1,64}$ ]]; }

nested_require_enabled() {
  [[ "${POC3_ID_PROBE_NESTED_ALLOW:-0}" == 1 ]] || {
    echo "error: nested POC3 ID probe transport is disabled by default (set POC3_ID_PROBE_NESTED_ALLOW=1 to enable)" >&2
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
  line="$("$GREP_BIN" -E -m 1 "^${key}=" -- "$file" 2>/dev/null)" || return 1
  printf '%s' "${line#*=}"
}

# Dependency-free manifest mutation lock (mkdir is atomic, no new
# dependency). Serializes probe record/clear mutations so concurrent probe
# runs cannot interleave tmp+mv and lose an update. Bounded wait,
# fail-closed when held.
probe_lock_acquire() {
  local workdir="$1" lockdir="$workdir/.manifest.lock" attempts=0
  while ! "$MKDIR_BIN" -- "$lockdir" 2>/dev/null; do
    attempts=$((attempts + 1))
    if [[ "$attempts" -ge 200 ]]; then
      echo "error: manifest lock is held for '$workdir'; refusing concurrent mutation (no lost update)" >&2
      return 1
    fi
    "$SLEEP_BIN" 0.05 || return 1
  done
}

probe_lock_release() {
  "$RMDIR_BIN" -- "$1/.manifest.lock" 2>/dev/null || true
}

# Retained probe identity: a successful exact signed script id is recorded
# atomically (probe_plugin/probe_script_id, all-or-nothing) before it can be
# used for cleanup. Caller-supplied ids without a matching manifest record
# are never trusted.
probe_record_success() {
  local manifest="$1" plugin="$2" script_id="$3"
  local workdir
  workdir="$("$DIRNAME_BIN" -- "$manifest")" || { echo "error: could not derive the probe workdir" >&2; return 1; }
  [[ "$plugin" == poc3-id-probe ]] || { echo "error: refusing to record unexpected plugin id '$plugin'" >&2; return 1; }
  [[ "$script_id" =~ ^[0-9]+$ && "$script_id" -le 2147483647 ]] || { echo "error: refusing to record invalid script id" >&2; return 1; }
  probe_lock_acquire "$workdir" || return 1
  if "$GREP_BIN" -q -e '^probe_plugin=' -e '^probe_script_id=' -- "$manifest"; then
    probe_lock_release "$workdir"
    echo "error: probe identity is already recorded; use cleanup WORKDIR first" >&2
    return 1
  fi
  local tmp
  tmp="$("$MKTEMP_BIN" "$workdir/.manifest.XXXXXX")" || { probe_lock_release "$workdir"; echo "error: could not stage the probe manifest" >&2; return 1; }
  "$CP_BIN" -p -- "$manifest" "$tmp" || { probe_lock_release "$workdir"; "$RM_BIN" -f -- "$tmp"; echo "error: could not stage the probe manifest" >&2; return 1; }
  {
    printf 'probe_plugin=%s\n' "$plugin"
    printf 'probe_script_id=%s\n' "$script_id"
  } >> "$tmp" || { probe_lock_release "$workdir"; "$RM_BIN" -f -- "$tmp"; echo "error: could not record probe identity" >&2; return 1; }
  "$MV_BIN" -f -- "$tmp" "$manifest" || { probe_lock_release "$workdir"; "$RM_BIN" -f -- "$tmp"; echo "error: could not finalize the probe manifest" >&2; return 1; }
  probe_lock_release "$workdir"
}

# Remove the retained probe record only after a verified unload.
probe_clear_record() {
  local manifest="$1"
  local workdir
  workdir="$("$DIRNAME_BIN" -- "$manifest")" || { echo "error: could not derive the probe workdir" >&2; return 1; }
  probe_lock_acquire "$workdir" || return 1
  local tmp
  tmp="$("$MKTEMP_BIN" "$workdir/.manifest.XXXXXX")" || { probe_lock_release "$workdir"; echo "error: could not stage the probe manifest" >&2; return 1; }
  "$GREP_BIN" -v -e '^probe_plugin=' -e '^probe_script_id=' -- "$manifest" > "$tmp" || true
  [[ -s "$tmp" ]] || { probe_lock_release "$workdir"; "$RM_BIN" -f -- "$tmp"; echo "error: probe record removal would empty the manifest" >&2; return 1; }
  "$MV_BIN" -f -- "$tmp" "$manifest" || { probe_lock_release "$workdir"; "$RM_BIN" -f -- "$tmp"; echo "error: could not finalize the probe manifest" >&2; return 1; }
  probe_lock_release "$workdir"
}

# Completion payload validation: a post-run detail line must carry the
# success marker `poc3-id-probe-done:<nonce>:` plus a JSON object with the
# exact bundle-bound owner/generation/nonce, expected_revision 0, and
# exactly three non-empty bounded IDs. Error payloads ({"error":...}) and
# mismatched success payloads fail closed with no record. Bounded: the
# caller truncates detail to 1KiB and the payload must fit within it.
probe_detail_is_success() {
  local detail="$1" owner="$2" generation="$3" nonce="$4"
  [[ -n "$detail" && -n "$owner" && -n "$generation" && -n "$nonce" ]] || return 1
  local marker="poc3-id-probe-done:$nonce:"
  [[ "$detail" == *"$marker"* ]] || return 1
  local payload="${detail##*"$marker"}"
  [[ -n "$payload" ]] || return 1
  [[ "$payload" != *$'\n'* ]] || return 1
  [[ "${#payload}" -le 1024 ]] || return 1
  printf '%s' "$payload" | "$JQ_BIN" -e \
    --arg owner "$owner" --arg generation "$generation" --arg nonce "$nonce" \
    'type == "object" and (has("error") | not) and (.owner == $owner) and (.generation == $generation) and (.nonce == $nonce) and (.expected_revision == 0) and (.ids | type == "array" and length == 3 and all(.[]; type == "string" and length > 0 and length <= 128))' >/dev/null 2>&1
}

# Best-effort rollback of exactly the probe_* group (no other keys).
# Used when post-record validation fails after a record was staged.
probe_rollback_record() {
  local manifest="$1"
  local workdir
  workdir="$("$DIRNAME_BIN" -- "$manifest")" || return 1
  probe_lock_acquire "$workdir" >/dev/null 2>&1 || return 1
  local tmp
  tmp="$("$MKTEMP_BIN" "$workdir/.manifest.XXXXXX")" || { probe_lock_release "$workdir"; return 1; }
  "$GREP_BIN" -v -e '^probe_plugin=' -e '^probe_script_id=' -- "$manifest" > "$tmp" || true
  [[ -s "$tmp" ]] || { probe_lock_release "$workdir"; "$RM_BIN" -f -- "$tmp"; return 1; }
  "$MV_BIN" -f -- "$tmp" "$manifest" || { probe_lock_release "$workdir"; "$RM_BIN" -f -- "$tmp"; return 1; }
  probe_lock_release "$workdir"
}

nested_validate_manifest() {
  local workdir="$1"
  [[ -n "$workdir" ]] || { echo "error: nested WORKDIR is empty" >&2; return 1; }
  local manifest_sh spawn_shell
  manifest_sh="$(resolve_manifest_sh)" || return 1
  spawn_shell="$(resolve_spawn_shell)" || return 1
  "$spawn_shell" "$manifest_sh" validate "$workdir" >&2 || {
    echo "error: nested manifest validation failed for '$workdir'" >&2
    return 1
  }
}

# Full manual-route ready validation: valid manifest, exactly three slots,
# no disposable client mix, live PID tick/exe/canonical/hash/dev/ino for
# clients plus drainers when recorded. Invoked via the exact repo manual
# script through the validated exact Nix Bash, with the manual allow env
# only for this validator invocation (never exported globally).
nested_validate_manual_ready() {
  local workdir="$1"
  [[ -n "$workdir" ]] || { echo "error: nested WORKDIR is empty" >&2; return 1; }
  local manual_sh spawn_shell
  manual_sh="$(resolve_manual_sh)" || return 1
  spawn_shell="$(resolve_spawn_shell)" || return 1
  NESTED_MANUAL_CLIENTS_ALLOW=1 "$spawn_shell" "$manual_sh" ready "$workdir" >&2 || {
    echo "error: nested manual ready validation failed for '$workdir'" >&2
    return 1
  }
}

nested_no_symlink_path() {
  local path="$1" current=/ component
  [[ "$path" == /* && "$path" != *'//'* ]] || return 1
  local IFS=/
  read -r -a _parts <<<"${path#/}" || return 1
  for component in ${_parts[@]+"${_parts[@]}"}; do
    [[ -n "$component" && "$component" != . && "$component" != .. ]] || return 1
    current="${current%/}/$component"
    [[ ! -L "$current" ]] || return 1
  done
}

# Fixed bundle guard: parent dir plus output must be safe absolute paths
# with no symlink components. A pre-existing output symlink fails closed
# (no target write). A verified non-symlink regular file is safely removed;
# absence is accepted. Any other pre-existing type fails closed.
nested_bundle_guard() {
  local bundle="$1" parent
  [[ "$bundle" == "$KWIN_DIR"/dist/poc3-id-probe.js ]] || { echo "error: refusing to build to an unexpected bundle path" >&2; return 1; }
  nested_safe_abs "$bundle" || { echo "error: probe bundle path is unsafe" >&2; return 1; }
  parent="$("$DIRNAME_BIN" -- "$bundle")"
  nested_safe_abs "$parent" || { echo "error: probe bundle parent is unsafe" >&2; return 1; }
  nested_no_symlink_path "$parent" || { echo "error: probe bundle parent traverses a symlink" >&2; return 1; }
  [[ -d "$parent" && ! -L "$parent" ]] || { echo "error: probe bundle parent is missing or symlinked" >&2; return 1; }
  nested_no_symlink_path "$bundle" 2>/dev/null || {
    if [[ -L "$bundle" ]]; then
      echo "error: probe bundle output is a symlink; refusing to write through it" >&2
      return 1
    fi
  }
  if [[ -L "$bundle" ]]; then
    echo "error: probe bundle output is a symlink; refusing to write through it" >&2
    return 1
  fi
  if [[ -e "$bundle" ]]; then
    [[ -f "$bundle" && ! -L "$bundle" ]] || { echo "error: probe bundle output is not a regular file; refusing overwrite" >&2; return 1; }
    "$RM_BIN" -f -- "$bundle" || { echo "error: could not remove verified non-symlink bundle" >&2; return 1; }
    [[ ! -e "$bundle" && ! -L "$bundle" ]] || { echo "error: probe bundle output still present after verified removal" >&2; return 1; }
  fi
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
  bus_file_content="$("$CAT_BIN" -- "$bus_path" 2>/dev/null)" || { echo "error: nested private bus file is unreadable" >&2; return 1; }
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
  out="$("$BUSCTL_BIN" --address="$NESTED_BUS_ADDRESS" --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE isScriptLoaded s "$plugin")" || {
    echo "error: isScriptLoaded call failed for '$plugin': $out" >&2
    return 1
  }
  strict_json_matches "$isloaded_valid" "$out" || {
    echo "error: unexpected isScriptLoaded reply for '$plugin': $out" >&2
    return 1
  }
  if [[ "$("$JQ_BIN" -r '.data[0]' <<<"$out")" == "true" ]]; then
    printf 'loaded\n'
  else
    printf 'not-loaded\n'
  fi
}

nested_refuse_when_production_loaded() {
  local production
  production="$(nested_loaded_word "$PRODUCTION_PLUGIN")" || exit 1
  if [[ "$production" == loaded ]]; then
    echo "error: production plugin '$PRODUCTION_PLUGIN' is loaded in the nested instance; refusing probe operation" >&2
    exit 1
  fi
}

nested_find_kwin_pid() {
  local owner_out owner pid_out pid manifest_pid
  owner_out="$("$BUSCTL_BIN" --address="$NESTED_BUS_ADDRESS" --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s "$BUS_DEST")" || return 1
  strict_json_matches "$dbus_string_valid" "$owner_out" || return 1
  owner="$("$JQ_BIN" -r '.data[0]' <<<"$owner_out")"
  [[ "$owner" =~ ^:[0-9]+\.[0-9]+$ ]] || return 1
  pid_out="$("$BUSCTL_BIN" --address="$NESTED_BUS_ADDRESS" --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetConnectionUnixProcessID s "$owner")" || return 1
  strict_json_matches "$dbus_pid_valid" "$pid_out" || return 1
  pid="$("$JQ_BIN" -r '.data[0]' <<<"$pid_out")"
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
  "$BUSCTL_BIN" --address="$NESTED_BUS_ADDRESS" call "$BUS_DEST" "/Scripting/Script$id" $BUS_SCRIPT_IFACE stop >/dev/null 2>&1 || true
  out="$("$BUSCTL_BIN" --address="$NESTED_BUS_ADDRESS" --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE unloadScript s "$PLUGIN" 2>/dev/null)" || return 1
  strict_json_matches "$unload_valid" "$out" || return 1
  [[ "$("$JQ_BIN" -r '.data[0]' <<<"$out")" == true ]] || return 1
  after="$(nested_loaded_word "$PLUGIN")" || return 1
  [[ "$after" == not-loaded ]] || return 1
}

nested_cleanup_loaded() {
  [[ -n "$SCRIPT_ID" ]] || return 1
  nested_exact_cleanup "$SCRIPT_ID"
}

nested_signal_during_probe() {
  local sig="$1" cleanup_state=unverified
  if [[ -n "$SCRIPT_ID" ]] && nested_cleanup_loaded; then cleanup_state=verified; fi
  printf 'probe: partial script-id=%s cleanup=%s\n' "${SCRIPT_ID:-unknown}" "$cleanup_state" >&2
  trap - INT TERM
  "$KILL_BIN" -"$sig" "$$"
}

parse_probe_args() {
  PROBE_OWNER=""; PROBE_GENERATION=""; PROBE_NONCE=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --owner) valid_owner "${2:-}" || { echo "error: invalid --owner" >&2; exit 1; }; PROBE_OWNER="$2"; shift 2 ;;
      --generation) valid_token "${2:-}" || { echo "error: invalid --generation" >&2; exit 1; }; PROBE_GENERATION="$2"; shift 2 ;;
      --nonce) valid_token "${2:-}" || { echo "error: invalid --nonce" >&2; exit 1; }; PROBE_NONCE="$2"; shift 2 ;;
      *) echo "error: unknown probe flag '$1'" >&2; exit 1 ;;
    esac
  done
  [[ -n "$PROBE_OWNER" ]] || { echo "error: probe requires --owner" >&2; exit 1; }
  [[ -n "$PROBE_GENERATION" ]] || { echo "error: probe requires --generation" >&2; exit 1; }
  [[ -n "$PROBE_NONCE" ]] || { echo "error: probe requires --nonce" >&2; exit 1; }
}

# Manual-route binding: load exactly three manifest-recorded manual client
# PIDs for the read-only eligibility check. Requires manual_count==3 plus all
# three manual_i_pid present, numeric, and distinct. Rejects partial groups,
# duplicate PIDs, and any disposable client_* group (the automatic route must
# never be accepted via the manual branch). Prints "p1,p2,p3" for the build
# helper; no process discovery, no caption/app-ID/title lookup.
# Note: full live ready validation (tick/exe/canonical/hash/dev/ino) is
# performed separately via nested_validate_manual_ready before this PID
# extraction, both before bundle build and again before transport.
nested_load_manual_pids() {
  local manifest="$1" count p1 p2 p3
  [[ -n "$manifest" ]] || return 1
  [[ -f "$manifest" && ! -L "$manifest" ]] || { echo "error: nested manifest file is absent or symlinked" >&2; return 1; }
  if "$GREP_BIN" -q -e '^client_' -- "$manifest"; then
    echo "error: disposable client_* group is recorded; manual probe refuses to mix modes" >&2
    return 1
  fi
  count="$(nested_manifest_get "$manifest" manual_count)" || { echo "error: manual group is not ready (missing manual_count)" >&2; return 1; }
  [[ "$count" == 3 ]] || { echo "error: manual_count must be exactly 3 for probe eligibility (found $count)" >&2; return 1; }
  p1="$(nested_manifest_get "$manifest" manual_1_pid)" || { echo "error: manual group is not ready (slot 1 missing)" >&2; return 1; }
  p2="$(nested_manifest_get "$manifest" manual_2_pid)" || { echo "error: manual group is not ready (slot 2 missing)" >&2; return 1; }
  p3="$(nested_manifest_get "$manifest" manual_3_pid)" || { echo "error: manual group is not ready (slot 3 missing)" >&2; return 1; }
  [[ "$p1" =~ ^[1-9][0-9]*$ && "$p2" =~ ^[1-9][0-9]*$ && "$p3" =~ ^[1-9][0-9]*$ ]] || { echo "error: manual PIDs must be positive integers" >&2; return 1; }
  [[ "$p1" != "$p2" && "$p1" != "$p3" && "$p2" != "$p3" ]] || { echo "error: recorded manual PIDs are not distinct" >&2; return 1; }
  [[ "$p1" -le 4294967295 && "$p2" -le 4294967295 && "$p3" -le 4294967295 ]] || { echo "error: manual PIDs out of range" >&2; return 1; }
  printf '%s,%s,%s' "$p1" "$p2" "$p3"
}

# Trio supervisor guard: preserves the exact pid enrollment model above
# (still enrolls only manual_1/2/3 PIDs) and adds only the required trio
# guard. When any diag_supervisor_* key is present, the full nine-key
# supervisor record must be present, its PID must be distinct from the three
# manual PIDs, and its live start-tick/exe must still match the record via
# PROC_ROOT. No broad discovery: only exact recorded PIDs are inspected.
nested_require_trio_guard() {
  local manifest="$1" pids="$2"
  [[ -n "$manifest" && -n "$pids" ]] || return 1
  if ! "$GREP_BIN" -q -e '^diag_supervisor_' -- "$manifest"; then
    return 0
  fi
  local spid stick sexe
  spid="$(nested_manifest_get "$manifest" diag_supervisor_pid)" || { echo "error: partial supervisor identity; refusing probe with ambiguous trio" >&2; return 1; }
  stick="$(nested_manifest_get "$manifest" diag_supervisor_starttick)" || { echo "error: partial supervisor identity; refusing probe with ambiguous trio" >&2; return 1; }
  sexe="$(nested_manifest_get "$manifest" diag_supervisor_exe)" || { echo "error: partial supervisor identity; refusing probe with ambiguous trio" >&2; return 1; }
  for _k in diag_supervisor_bin diag_supervisor_bin_canonical diag_supervisor_bin_sha256 diag_supervisor_bin_dev diag_supervisor_bin_ino diag_supervisor_diag_path; do
    nested_manifest_get "$manifest" "$_k" >/dev/null || { echo "error: partial supervisor identity; refusing probe with ambiguous trio" >&2; return 1; }
  done
  [[ "$spid" =~ ^[1-9][0-9]*$ ]] || { echo "error: supervisor PID must be a positive integer" >&2; return 1; }
  [[ "$stick" =~ ^[1-9][0-9]*$ ]] || { echo "error: supervisor starttick must be a positive integer" >&2; return 1; }
  case ",$pids," in
    *",$spid,"*) { echo "error: supervisor PID collides with manual PIDs; refusing ambiguous trio" >&2; return 1; } ;;
  esac
  # Supervisor live identity via PROC_ROOT, matching _manifest_starttick /
  # _manifest_exe semantics in scripts/nested-kwin-manifest.sh (no awk):
  # the stat content must be a single line whose leading PID matches, the
  # post-comm tail (after the last ") ") must carry a valid state plus a
  # positive start tick, and the exe symlink must resolve to a non-deleted
  # absolute target. Comm names with spaces or parentheses are handled by
  # splitting after the last ") ".
  local _stat_line="" _stat_pid="" _stat_rest="" _exe_target=""
  local -a _stat_fields=()
  _stat_line="$(<"${PROC_ROOT:-/proc}/$spid/stat")" || { echo "error: supervisor pid $spid is stale or unreadable (PID reuse suspected)" >&2; return 1; }
  [[ "$_stat_line" != *$'\n'* ]] || { echo "error: supervisor identity is unreadable" >&2; return 1; }
  _stat_pid="${_stat_line%% *}"
  [[ "$_stat_pid" == "$spid" ]] || { echo "error: supervisor pid $spid is stale or unreadable (PID reuse suspected)" >&2; return 1; }
  _stat_rest="${_stat_line##*) }"
  [[ "$_stat_rest" != "$_stat_line" ]] || { echo "error: supervisor identity is unreadable" >&2; return 1; }
  read -r -a _stat_fields <<<"$_stat_rest" || { echo "error: supervisor identity is unreadable" >&2; return 1; }
  [[ "${#_stat_fields[@]}" -ge 20 && "${_stat_fields[0]:-}" =~ ^[A-Za-z]$ ]] || { echo "error: supervisor identity is unreadable" >&2; return 1; }
  [[ "${_stat_fields[19]:-}" =~ ^[1-9][0-9]*$ ]] || { echo "error: supervisor identity is unreadable" >&2; return 1; }
  [[ "${_stat_fields[19]}" == "$stick" ]] || { echo "error: supervisor start-tick mismatch (PID reuse suspected)" >&2; return 1; }
  _exe_target="$("$READLINK_BIN" "${PROC_ROOT:-/proc}/$spid/exe" 2>/dev/null)" || { echo "error: supervisor executable identity is unreadable" >&2; return 1; }
  [[ -n "$_exe_target" && "$_exe_target" == /* ]] || { echo "error: supervisor executable identity is unreadable" >&2; return 1; }
  [[ "$_exe_target" != *' (deleted)' && "$_exe_target" != *' (deleted) '* ]] || { echo "error: supervisor executable identity is unreadable" >&2; return 1; }
  [[ "$_exe_target" == "$sexe" ]] || { echo "error: supervisor executable mismatch" >&2; return 1; }
}

nested_cmd_probe() {
  local workdir="$1"
  shift
  nested_require_enabled
  require_proc_root || exit 1
  STAT_BIN="$(resolve_stat_bin)" || exit 1
  SHA256SUM_BIN="$(resolve_sha256sum_bin)" || exit 1
  KILL_BIN="$(resolve_kill_bin)" || exit 1
  READLINK_BIN="$(resolve_readlink_bin)" || exit 1
  BUSCTL_BIN="$(resolve_busctl_bin)" || exit 1
  JQ_BIN="$(resolve_jq_bin)" || exit 1
  NODE_BIN="$(resolve_node_bin)" || exit 1
  GREP_BIN="$(resolve_grep_bin)" || exit 1
  TAIL_BIN="$(resolve_tail_bin)" || exit 1
  WC_BIN="$(resolve_wc_bin)" || exit 1
  SLEEP_BIN="$(resolve_sleep_bin)" || exit 1
  HEAD_BIN="$(resolve_head_bin)" || exit 1
  AWK_BIN="$(resolve_awk_bin)" || exit 1
  MKDIR_BIN="$(resolve_mkdir_bin)" || exit 1
  RMDIR_BIN="$(resolve_rmdir_bin)" || exit 1
  MKTEMP_BIN="$(resolve_mktemp_bin)" || exit 1
  CP_BIN="$(resolve_cp_bin)" || exit 1
  MV_BIN="$(resolve_mv_bin)" || exit 1
  RM_BIN="$(resolve_rm_bin)" || exit 1
  CAT_BIN="$(resolve_cat_bin)" || exit 1
  DIRNAME_BIN="$(resolve_dirname_bin)" || exit 1
  pinned_jq_pretransport_check || exit 1
  local _probe_shell _probe_manifest _probe_manual
  _probe_shell="$(resolve_spawn_shell)" || exit 1
  _probe_manifest="$(resolve_manifest_sh)" || exit 1
  _probe_manual="$(resolve_manual_sh)" || exit 1
  nested_require_enabled
  [[ "$PLUGIN" == poc3-id-probe ]] || {
    echo "error: refusing to operate on unexpected plugin id '$PLUGIN'" >&2
    exit 1
  }
  [[ "$BUNDLE" == "$KWIN_DIR"/dist/poc3-id-probe.js ]] || {
    echo "error: refusing to build to an unexpected bundle path" >&2
    exit 1
  }
  [[ "$BUILD_HELPER" == "$REPO_ROOT/scripts/poc3-build-id-probe.mjs" ]] || {
    echo "error: refusing to build with an unexpected helper path" >&2
    exit 1
  }
  [[ -f "$BUILD_HELPER" && ! -L "$BUILD_HELPER" ]] || {
    echo "error: probe build helper is unavailable or symlinked: $BUILD_HELPER" >&2
    exit 1
  }
  trap 'nested_signal_during_probe INT' INT
  trap 'nested_signal_during_probe TERM' TERM
  nested_validate_manifest "$workdir" || exit 1
  nested_load_private_state "$workdir" || exit 1
  # Full manual-route ready validation before bundle build: valid manifest,
  # exactly three slots, no client mix, live tick/exe/canonical/hash/dev/ino.
  nested_validate_manual_ready "$workdir" || exit 1
  if "$GREP_BIN" -q -e '^probe_plugin=' -e '^probe_script_id=' -- "$NESTED_WORKDIR/manifest"; then
    echo "error: probe identity is already recorded for this WORKDIR; use cleanup WORKDIR first" >&2
    exit 1
  fi
  parse_probe_args "$@"
  MANUAL_PIDS="$(nested_load_manual_pids "$NESTED_WORKDIR/manifest")" || exit 1
  [[ "$MANUAL_PIDS" =~ ^[1-9][0-9]*,[1-9][0-9]*,[1-9][0-9]*$ ]] || { echo "error: manual PIDs failed validation" >&2; exit 1; }
  nested_require_trio_guard "$NESTED_WORKDIR/manifest" "$MANUAL_PIDS" || exit 1
  # Fixed bundle guard before any build: parent/output safe and non-symlink;
  # a pre-existing symlink fails closed with no target write. A verified
  # non-symlink regular file is safely removed; absence is accepted.
  nested_bundle_guard "$BUNDLE" || exit 1
  "$NODE_BIN" "$BUILD_HELPER" --owner "$PROBE_OWNER" --generation "$PROBE_GENERATION" --nonce "$PROBE_NONCE" --expected-pids "$MANUAL_PIDS" --out "$BUNDLE" || {
    echo "error: probe bundle build failed" >&2
    exit 1
  }
  [[ -f "$BUNDLE" && ! -L "$BUNDLE" ]] || {
    echo "error: probe bundle was not created at the expected dist path" >&2
    exit 1
  }
  nested_no_symlink_path "$BUNDLE" || { echo "error: probe bundle traverses a symlink after build" >&2; exit 1; }
  nested_validate_manifest "$workdir" || exit 1
  nested_load_private_state "$workdir" || exit 1
  # Second full manual-route ready validation immediately before transport:
  # re-binds the exact three live identities so a PID reuse or replacement
  # between build and load fails closed with no transport.
  nested_validate_manual_ready "$workdir" || exit 1
  MANUAL_PIDS_VERIFY="$(nested_load_manual_pids "$NESTED_WORKDIR/manifest")" || exit 1
  [[ "$MANUAL_PIDS_VERIFY" == "$MANUAL_PIDS" ]] || { echo "error: manual PIDs changed between build and transport; refusing stale bundle" >&2; exit 1; }
  nested_require_trio_guard "$NESTED_WORKDIR/manifest" "$MANUAL_PIDS_VERIFY" || exit 1
  nested_refuse_when_production_loaded
  if [[ "$(nested_loaded_word "$PLUGIN")" == loaded ]]; then
    echo "error: plugin '$PLUGIN' is already loaded; refusing to load again" >&2
    exit 1
  fi
  KWIN_PID="$(nested_find_kwin_pid)" || {
    echo "error: could not identify one nested KWin process" >&2
    exit 1
  }
  local load_out script_obj introspect_out attempt done_marker
  load_out="$("$BUSCTL_BIN" --address="$NESTED_BUS_ADDRESS" --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE loadScript ss "$BUNDLE" "$PLUGIN")" || {
    echo "error: loadScript call failed: $load_out" >&2
    exit 1
  }
  strict_json_matches "$load_valid" "$load_out" || {
    echo "error: unexpected loadScript reply: $load_out" >&2
    exit 1
  }
  SCRIPT_ID="$("$JQ_BIN" -r '.data[0]' <<<"$load_out")"
  script_obj="/Scripting/Script$SCRIPT_ID"
  introspect_out="$("$BUSCTL_BIN" --address="$NESTED_BUS_ADDRESS" --json=short introspect "$BUS_DEST" "$script_obj")" || {
    echo "error: introspect failed for $script_obj" >&2
    if nested_cleanup_loaded; then echo "probe: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "probe: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
    exit 1
  }
  strict_json_matches "$script_iface_valid" "$introspect_out" || {
    echo "error: $script_obj does not expose the org.kde.kwin.Script interface" >&2
    if nested_cleanup_loaded; then echo "probe: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "probe: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
    exit 1
  }
  if [[ "$(nested_loaded_word "$PLUGIN")" != loaded ]]; then
    echo "error: plugin '$PLUGIN' was not reported loaded after exact object introspection" >&2
    if nested_cleanup_loaded; then echo "probe: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "probe: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
    exit 1
  fi
  # Pre-run log boundary: a reused nonce must never match a stale completion
  # line already in the private log. Snapshot the byte size before run and
  # examine only post-run bytes below (fail-closed on stat failure).
  local probe_log_start=""
  probe_log_start="$("$STAT_BIN" -c %s -- "$NESTED_LOG_PATH" 2>/dev/null)" || {
    echo "error: could not snapshot the private log boundary before probe run" >&2
    if nested_cleanup_loaded; then echo "probe: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "probe: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
    exit 1
  }
  [[ "$probe_log_start" =~ ^[0-9]+$ ]] || {
    echo "error: private log boundary is not a byte size; refusing stale-prone scan" >&2
    if nested_cleanup_loaded; then echo "probe: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "probe: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
    exit 1
  }
  if ! "$BUSCTL_BIN" --address="$NESTED_BUS_ADDRESS" --json=short call "$BUS_DEST" "$script_obj" $BUS_SCRIPT_IFACE run >/dev/null 2>&1; then
    echo "error: run() failed on $script_obj" >&2
    if nested_cleanup_loaded; then echo "probe: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "probe: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
    exit 1
  fi
  done_marker="poc3-id-probe-done:$PROBE_NONCE"
  # Bounded post-run log scan: only bytes appended after the pre-run boundary
  # (fixed 64KiB tail window of the post-run slice) plus a fixed 1KiB
  # diagnostic. No unlimited tail and no O(n^2) re-scan of a growing log.
  PROBE_LOG_WINDOW_BYTES=65536
  PROBE_DIAG_LIMIT=1024
  local post_run=""
  for ((attempt = 0; attempt < READINESS_ATTEMPTS; attempt += 1)); do
    post_run="$("$TAIL_BIN" -c "+$((probe_log_start + 1))" -- "$NESTED_LOG_PATH" 2>/dev/null | "$TAIL_BIN" -c "$PROBE_LOG_WINDOW_BYTES" 2>/dev/null)" || post_run=""
    if printf '%s' "$post_run" | "$GREP_BIN" -F -m 1 -- "$done_marker" >/dev/null 2>&1; then
      trap - INT TERM
      local detail
      detail="$(printf '%s' "$post_run" | "$GREP_BIN" -F -- "$done_marker" | "$TAIL_BIN" -n 1 | "$HEAD_BIN" -c "$PROBE_DIAG_LIMIT")"
      # Success/error distinction: an error payload or a mismatched success
      # payload (wrong nonce/owner/generation/revision/IDs) is never recorded
      # as a successful probe completion. Fail closed with exact cleanup.
      if ! probe_detail_is_success "$detail" "$PROBE_OWNER" "$PROBE_GENERATION" "$PROBE_NONCE"; then
        echo "error: probe completion payload failed success validation; refusing to record" >&2
        if nested_cleanup_loaded; then echo "probe: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "probe: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
        exit 1
      fi
      nested_validate_manifest "$workdir" || {
        echo "error: manifest no longer validates before probe record; preserving residue" >&2
        if nested_cleanup_loaded; then echo "probe: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "probe: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
        exit 1
      }
      nested_load_private_state "$workdir" || {
        echo "error: private state no longer validates before probe record; preserving residue" >&2
        if nested_cleanup_loaded; then echo "probe: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "probe: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
        exit 1
      }
      # Post-transport revalidation before recording success: exact manual
      # identities plus PID equality with the transported bundle plus the trio
      # guard. A PID reuse or replacement after transport fails closed with no
      # record.
      nested_validate_manual_ready "$workdir" || {
        echo "error: manual identities no longer validate after transport; preserving residue" >&2
        if nested_cleanup_loaded; then echo "probe: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "probe: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
        exit 1
      }
      MANUAL_PIDS_POST="$(nested_load_manual_pids "$NESTED_WORKDIR/manifest")" || {
        echo "error: manual PIDs no longer validate after transport; preserving residue" >&2
        if nested_cleanup_loaded; then echo "probe: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "probe: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
        exit 1
      }
      [[ "$MANUAL_PIDS_POST" == "$MANUAL_PIDS" ]] || {
        echo "error: manual PIDs changed after transport; refusing stale bundle" >&2
        if nested_cleanup_loaded; then echo "probe: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "probe: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
        exit 1
      }
      nested_require_trio_guard "$NESTED_WORKDIR/manifest" "$MANUAL_PIDS_POST" || {
        echo "error: trio guard no longer validates after transport; preserving residue" >&2
        if nested_cleanup_loaded; then echo "probe: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "probe: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
        exit 1
      }
      probe_record_success "$NESTED_WORKDIR/manifest" "$PLUGIN" "$SCRIPT_ID" || {
        echo "error: could not atomically record probe identity; preserving residue" >&2
        if nested_cleanup_loaded; then echo "probe: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "probe: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
        exit 1
      }
      nested_validate_manifest "$workdir" || {
        echo "error: fresh probe manifest failed validation; attempting exact unload and record rollback" >&2
        if nested_cleanup_loaded; then
          echo "probe: partial script-id=$SCRIPT_ID cleanup=verified" >&2
          probe_rollback_record "$NESTED_WORKDIR/manifest" >/dev/null 2>&1 || true
        else
          echo "probe: partial script-id=$SCRIPT_ID cleanup=unverified" >&2
        fi
        exit 1
      }
      printf 'probe: done pid=%s script-id=%s plugin=%s nonce=%s outcome=%s\n' "$KWIN_PID" "$SCRIPT_ID" "$PLUGIN" "$PROBE_NONCE" "$detail"
      printf 'probe cleanup command: POC3_ID_PROBE_NESTED_ALLOW=1 %s %s nested %s cleanup %s\n' "$_probe_shell" "$0" "$workdir" "$SCRIPT_ID"
      exit 0
    fi
    "$SLEEP_BIN" "$READINESS_DELAY"
  done
  echo "error: probe completion diagnostic was not confirmed in the nested private log" >&2
  if nested_cleanup_loaded; then echo "probe: partial script-id=$SCRIPT_ID cleanup=verified" >&2; else echo "probe: partial script-id=$SCRIPT_ID cleanup=unverified" >&2; fi
  exit 1
}

nested_cmd_cleanup() {
  local workdir="$1" script_id="${2:-}"
  shift 2 || true
  [[ $# -eq 0 ]] || { echo "error: cleanup takes no further args" >&2; exit 1; }
  [[ "$script_id" =~ ^[0-9]+$ && "$script_id" -le 2147483647 ]] || {
    echo "error: cleanup requires one non-negative 32-bit script ID" >&2
    exit 1
  }
  nested_require_enabled
  require_proc_root || exit 1
  BUSCTL_BIN="$(resolve_busctl_bin)" || exit 1
  JQ_BIN="$(resolve_jq_bin)" || exit 1
  GREP_BIN="$(resolve_grep_bin)" || exit 1
  KILL_BIN="$(resolve_kill_bin)" || exit 1
  STAT_BIN="$(resolve_stat_bin)" || exit 1
  SHA256SUM_BIN="$(resolve_sha256sum_bin)" || exit 1
  READLINK_BIN="$(resolve_readlink_bin)" || exit 1
  SLEEP_BIN="$(resolve_sleep_bin)" || exit 1
  MKDIR_BIN="$(resolve_mkdir_bin)" || exit 1
  RMDIR_BIN="$(resolve_rmdir_bin)" || exit 1
  MKTEMP_BIN="$(resolve_mktemp_bin)" || exit 1
  CP_BIN="$(resolve_cp_bin)" || exit 1
  MV_BIN="$(resolve_mv_bin)" || exit 1
  RM_BIN="$(resolve_rm_bin)" || exit 1
  CAT_BIN="$(resolve_cat_bin)" || exit 1
  DIRNAME_BIN="$(resolve_dirname_bin)" || exit 1
  pinned_jq_pretransport_check || exit 1
  [[ "$PLUGIN" == poc3-id-probe ]] || {
    echo "error: refusing to operate on unexpected plugin id '$PLUGIN'" >&2
    exit 1
  }
  nested_validate_manifest "$workdir" || exit 1
  nested_load_private_state "$workdir" || exit 1
  local manifest="$workdir/manifest" rec_plugin="" rec_id="" has_plugin=0 has_id=0
  "$GREP_BIN" -q -e '^probe_plugin=' -- "$manifest" && has_plugin=1 || true
  "$GREP_BIN" -q -e '^probe_script_id=' -- "$manifest" && has_id=1 || true
  if [[ "$has_plugin" -eq 0 && "$has_id" -eq 0 ]]; then
    echo "error: no retained probe identity in manifest; refusing caller-supplied script id $script_id without a matching record" >&2
    exit 1
  fi
  [[ "$has_plugin" -eq 1 && "$has_id" -eq 1 ]] || {
    echo "error: partial probe identity in manifest; refusing ambiguous cleanup" >&2
    exit 1
  }
  rec_plugin="$(nested_manifest_get "$manifest" probe_plugin)" || { echo "error: manifest is missing probe_plugin" >&2; exit 1; }
  rec_id="$(nested_manifest_get "$manifest" probe_script_id)" || { echo "error: manifest is missing probe_script_id" >&2; exit 1; }
  [[ "$rec_plugin" == poc3-id-probe ]] || { echo "error: manifest probe plugin must be exactly poc3-id-probe (found $rec_plugin)" >&2; exit 1; }
  [[ "$rec_id" =~ ^[0-9]+$ && "$rec_id" -le 2147483647 ]] || { echo "error: manifest probe script id is not a non-negative 32-bit integer" >&2; exit 1; }
  [[ "$script_id" == "$rec_id" ]] || {
    echo "error: caller script id $script_id does not match manifest probe_script_id $rec_id; refusing without exact record match" >&2
    exit 1
  }
  local introspect_out loaded
  introspect_out="$("$BUSCTL_BIN" --address="$NESTED_BUS_ADDRESS" --json=short introspect "$BUS_DEST" "/Scripting/Script$script_id" 2>/dev/null)" || {
    echo "error: introspect failed for /Scripting/Script$script_id; refusing teardown without exact object proof" >&2
    exit 1
  }
  strict_json_matches "$script_iface_valid" "$introspect_out" || {
    echo "error: /Scripting/Script$script_id does not expose the org.kde.kwin.Script interface" >&2
    exit 1
  }
  loaded="$(nested_loaded_word "$PLUGIN")" || exit 1
  if [[ "$loaded" == not-loaded ]]; then
    echo "error: probe plugin '$PLUGIN' is not loaded; refusing to use stale script id $script_id" >&2
    exit 1
  fi
  SCRIPT_ID="$script_id"
  nested_exact_cleanup "$script_id" || {
    echo "error: exact probe teardown was not verified; refusing to claim cleanup complete" >&2
    exit 1
  }
  probe_clear_record "$manifest" || {
    echo "error: exact unload verified but probe record removal failed; preserving manifest" >&2
    exit 1
  }
  nested_validate_manifest "$workdir" || {
    echo "error: manifest no longer validates after probe record removal; preserving residue" >&2
    exit 1
  }
  printf 'probe-cleanup: script-id=%s plugin=%s unloaded and verified loaded-after=not-loaded\n' "$script_id" "$PLUGIN"
}

if [[ $# -eq 1 && ("$1" == --help || "$1" == help) ]]; then
  usage
  exit 0
fi
if [[ $# -ge 3 && "$1" == nested ]]; then
  nested_workdir="$2"
  nested_op="$3"
  shift 3
  case "$nested_op" in
    probe) nested_cmd_probe "$nested_workdir" "$@" ;;
    cleanup) nested_cmd_cleanup "$nested_workdir" "$@" ;;
    *) usage >&2; exit 1 ;;
  esac
else
  usage >&2
  exit 1
fi
