#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "${BASH_SOURCE[0]%/*}" && pwd -P)"

readonly AUTHORIZATION="FLOOR-RATIO-NESTED-LIVE-PROOF-V1"
readonly REQUIRED_KWIN_VERSION="6.7.4"
readonly REQUIRED_CHILD_PROCESSES=1
readonly MAX_ATTEMPTS=1
readonly REQUIRED_LAYOUT="fixed-disposable-custom-tile"
readonly REQUIRED_SOCKET="absolute-parent-wayland-socket"
readonly REQUIRED_XDG="private-xdg-homes-runtime-session-bus"
readonly REQUIRED_TIMEOUT="bounded"
readonly REQUIRED_JOURNAL_SCOPE="fresh-cursor-same-child-pid-project-logs"
readonly REQUIRED_PERSISTENCE="host-kwinrc-hash-mtime-before-after-private-persistence"
readonly COMMAND_ALLOWLIST="kwin_wayland,busctl,journalctl,sha256sum,stat,timeout,mkdir,mktemp,rm,printf"
readonly CLEANUP_ORDER="stop-child restore-persistence remove-private-roots retain-evidence"

readonly CASE_SINGLE="single-ancestor-write"
readonly CASE_MULTI="multi-ancestor-writes"
readonly CASE_IMPOSSIBLE="impossible-allocation-retaining-current-fallback"
readonly CASE_MISMATCH="post-write-mismatch-refusal"
readonly STATIC_PAUSE_SECONDS=5
STATIC_ROOT=""
STATIC_EVIDENCE_ROOT=""
SIGNAL_EVIDENCE=""
SIGNAL_DISPOSABLE=""
CLEANUP_EVIDENCE=""
MKDIR_BIN=""
MKTEMP_BIN=""
RM_BIN=""
SLEEP_BIN=""
LN_BIN=""

usage() {
  builtin printf '%s\n' \
    'usage: floor-ratio-feasibility.sh <command>' \
    '' \
    'Commands:' \
    '  static-self-test  run the hermetic static model and its invariant checks' \
    '  --help            show this help' \
    '' \
    'The only executable command is static-self-test. The future live-proof gate' \
    'accepts exactly one vector and the authorization token, then refuses safely:' \
    'an additional separate user authorization is required before any live' \
    'execution can be implemented. No live execution is present here.'
}

fail() {
  printf 'error: %s\n' "$1" >&2
  return 1
}

assert_value() {
  local expected="$1" actual="$2" description="$3"
  if [[ "$expected" == "$actual" ]]; then
    PASS=$((PASS + 1))
  else
    printf 'FAIL: %s (expected %s, got %s)\n' "$description" "$expected" "$actual" >&2
    FAILURES=$((FAILURES + 1))
  fi
}

assert_file() {
  local path="$1" description="$2"
  if [[ -f "$path" ]]; then
    PASS=$((PASS + 1))
  else
    printf 'FAIL: %s (missing %s)\n' "$description" "$path" >&2
    FAILURES=$((FAILURES + 1))
  fi
}

record() {
  printf '%s\n' "$2" >> "$1/operation-trace.log"
}

resolve_trusted_tool() {
  local name="$1" output="$2" directory candidate
  local -a path_entries
  IFS=: read -r -a path_entries <<< "${PATH:-}"
  for directory in "${path_entries[@]}"; do
    case "$directory" in
      /nix/store/*/bin|/usr/bin|/bin) ;;
      *) continue ;;
    esac
    candidate="$directory/$name"
    if [[ -x "$candidate" && ! -d "$candidate" ]]; then
      printf -v "$output" '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

resolve_static_tools() {
  resolve_trusted_tool mkdir MKDIR_BIN || return 1
  resolve_trusted_tool mktemp MKTEMP_BIN || return 1
  resolve_trusted_tool rm RM_BIN || return 1
  resolve_trusted_tool sleep SLEEP_BIN || return 1
  resolve_trusted_tool ln LN_BIN || return 1
}

canonical_directory() {
  local path="$1" canonical
  [[ "$path" == /* && -d "$path" && ! -L "$path" ]] || return 1
  canonical="$(cd -P -- "$path" && pwd -P)" || return 1
  [[ "$canonical" == "$path" ]] || return 1
  printf '%s\n' "$canonical"
}

safe_remove_nonce_tree() {
  local nonce_root="$1" candidate="$2" canonical_root canonical_candidate
  [[ -n "$RM_BIN" ]] || return 1
  [[ -d "$nonce_root" && ! -L "$nonce_root" && -O "$nonce_root" ]] || return 1
  [[ -d "$candidate" && ! -L "$candidate" && -O "$candidate" ]] || return 1
  canonical_root="$(canonical_directory "$nonce_root")" || return 1
  canonical_candidate="$(canonical_directory "$candidate")" || return 1
  [[ "$canonical_root" == "$nonce_root" && "$canonical_candidate" == "$candidate" ]] || return 1
  [[ "$candidate" == "$nonce_root" || "$candidate" == "$nonce_root"/* ]] || return 1
  [[ "$canonical_candidate" == "$canonical_root" || "$canonical_candidate" == "$canonical_root"/* ]] || return 1
  "$RM_BIN" -rf -- "$candidate"
}

fresh_decode() {
  local evidence="$1" state="$2" label="$3" number
  number=0
  if [[ -f "$evidence/decode.count" ]]; then
    number="$(<"$evidence/decode.count")"
  fi
  number=$((number + 1))
  printf '%s\n' "$number" > "$evidence/decode.count"
  printf 'decode-%s:%s:%s\n' "$number" "$label" "$state" > "$evidence/decode.$number"
  record "$evidence" "fresh-decode:$label:$state"
}

write_plan() {
  local evidence="$1" target="$2" value="$3"
  printf 'target=%s value=%s\n' "$target" "$value" >> "$evidence/plans.log"
  record "$evidence" "plan:$target"
}

write_mutation() {
  local evidence="$1" target="$2" value="$3"
  printf 'target=%s value=%s\n' "$target" "$value" >> "$evidence/writes.log"
  record "$evidence" "write:$target"
}

cleanup_trace() {
  local evidence="$1" reason="$2" disposable="$3"
  if [[ "$CLEANUP_EVIDENCE" == "$evidence" ]]; then
    return 0
  fi
  CLEANUP_EVIDENCE="$evidence"
  record "$evidence" "stop-reason:$reason"
  record "$evidence" "cleanup:stop-child"
  record "$evidence" "cleanup:restore-persistence"
  safe_remove_nonce_tree "$STATIC_ROOT" "$disposable" || return 1
  record "$evidence" "cleanup:remove-private-roots"
  printf 'stop-reason=%s\n' "$reason" > "$evidence/retained-evidence"
  record "$evidence" "cleanup:retain-evidence"
}

assert_cleanup_order() {
  local evidence="$1"
  local -a trace expected
  mapfile -t trace < "$evidence/operation-trace.log"
  expected=("cleanup:stop-child" "cleanup:restore-persistence" "cleanup:remove-private-roots" "cleanup:retain-evidence")
  [[ "${trace[@]: -4}" == "${expected[*]}" ]]
}

handle_signal() {
  local signal="$1"
  trap - EXIT INT TERM
  if [[ -n "$SIGNAL_EVIDENCE" && -n "$MKDIR_BIN" ]]; then
    "$MKDIR_BIN" -p "$SIGNAL_DISPOSABLE" 2>/dev/null || true
  fi
  if [[ -d "$SIGNAL_EVIDENCE" && -d "$SIGNAL_DISPOSABLE" ]]; then
    if [[ ! -e "$SIGNAL_EVIDENCE/vector" ]]; then
      printf 'vector=interrupted-run\n' > "$SIGNAL_EVIDENCE/vector"
    fi
    cleanup_trace "$SIGNAL_EVIDENCE" "signal-$signal" "$SIGNAL_DISPOSABLE" || true
  fi
  printf 'static evidence retained at: %s\n' "$SIGNAL_EVIDENCE" >&2
  builtin kill -s "$signal" "$$"
}

retain_or_remove_static_root() {
  local status=$?
  trap - EXIT
  if [[ "$status" -eq 0 && -n "$STATIC_ROOT" ]]; then
    safe_remove_nonce_tree "$STATIC_ROOT" "$STATIC_ROOT" || status=1
  fi
  if [[ "$status" -ne 0 && -n "$STATIC_ROOT" ]]; then
    printf 'static evidence retained at: %s\n' "$STATIC_EVIDENCE_ROOT" >&2
  fi
  exit "$status"
}

simulate_vector() {
  local evidence="$1" vector="$2" state="current-fallback" writes=0 stop_reason="vector-complete"
  "$MKDIR_BIN" -p "$evidence"
  printf 'vector=%s\n' "$vector" > "$evidence/vector"
  fresh_decode "$evidence" "$state" baseline

  case "$vector" in
    "$CASE_SINGLE")
      write_plan "$evidence" ancestor-1 ratio-1-2
      write_mutation "$evidence" ancestor-1 ratio-1-2
      writes=1
      state="ratio-1-2"
      fresh_decode "$evidence" "$state" after-write:ancestor-1
      ;;
    "$CASE_MULTI")
      write_plan "$evidence" ancestor-1 ratio-1-2
      write_plan "$evidence" ancestor-2 ratio-1-3
      write_mutation "$evidence" ancestor-1 ratio-1-2
      writes=1
      state="ratio-1-2"
      fresh_decode "$evidence" "$state" after-write:ancestor-1
      write_mutation "$evidence" ancestor-2 ratio-1-3
      writes=2
      state="ratio-1-3"
      fresh_decode "$evidence" "$state" after-write:ancestor-2
      ;;
    "$CASE_IMPOSSIBLE")
      stop_reason="impossible-allocation"
      write_plan "$evidence" allocation impossible
      printf 'fallback=%s\n' "$state" > "$evidence/fallback"
      record "$evidence" "fallback-retained:$state"
      ;;
    "$CASE_MISMATCH")
      stop_reason="post-write-mismatch"
      write_plan "$evidence" ancestor-1 ratio-candidate
      write_mutation "$evidence" ancestor-1 ratio-candidate
      writes=1
      fresh_decode "$evidence" "mismatch" after-write:ancestor-1
      record "$evidence" "refuse:no-split-no-reverse-write"
      printf 'mismatch=true\n' > "$evidence/mismatch"
      ;;
    *)
      return 1
      ;;
  esac

  printf '%s\n' "$writes" > "$evidence/write-count"
  if [[ "$vector" == "$CASE_IMPOSSIBLE" ]]; then
    [[ "$writes" -eq 0 ]] || return 1
    [[ "$(<"$evidence/fallback")" == 'fallback=current-fallback' ]] || return 1
  fi
  if [[ "$vector" == "$CASE_MISMATCH" ]]; then
    [[ "$writes" -eq 1 ]] || return 1
    [[ "$(<"$evidence/mismatch")" == 'mismatch=true' ]] || return 1
    if [[ -s "$evidence/reverse-write" || -s "$evidence/split-write" ]]; then
      return 1
    fi
  fi
  cleanup_trace "$evidence" "$stop_reason" "$evidence/disposable"
  assert_cleanup_order "$evidence"
}

static_self_test() {
  local root private host evidence vector decode_count write_count requested_tmp canonical_tmp pause_pid unsafe_path
  PASS=0
  FAILURES=0
  trap retain_or_remove_static_root EXIT
  resolve_static_tools || { printf 'error: no trusted static utilities were found\n' >&2; return 1; }
  requested_tmp="${TMPDIR:-/tmp}"
  canonical_tmp="$(canonical_directory "$requested_tmp")" || { printf 'error: TMPDIR must be an existing, non-symlinked absolute directory\n' >&2; return 1; }
  if ! root="$("$MKTEMP_BIN" -d -- "$canonical_tmp/floor-ratio-static.XXXXXX")"; then
    return 1
  fi
  if [[ ! -d "$root" || -L "$root" || ! -O "$root" || "$root" != "$canonical_tmp"/floor-ratio-static.* ]] || [[ "$(canonical_directory "$root")" != "$root" ]]; then
    printf 'error: mktemp did not create a nonce-owned canonical private root\n' >&2
    return 1
  fi
  STATIC_ROOT="$root"
  private="$root/private-static-nonce"
  host="$root/host-sentinel"
  STATIC_EVIDENCE_ROOT="$private/evidence"
  SIGNAL_EVIDENCE="$private/evidence/interrupted-run"
  SIGNAL_DISPOSABLE="$SIGNAL_EVIDENCE/disposable"
  trap 'handle_signal INT' INT
  trap 'handle_signal TERM' TERM
  case "${FLOOR_RATIO_STATIC_TEST_EARLY_SIGNAL:-}" in
    INT|TERM)
      builtin kill -s "$FLOOR_RATIO_STATIC_TEST_EARLY_SIGNAL" "$$"
      ;;
  esac
  "$MKDIR_BIN" -p "$private/evidence" "$host"
  printf 'host-kwinrc-sentinel\n' > "$host/kwinrc"
  local host_before
  host_before="$(<"$host/kwinrc")"

  # A symlink escaping the nonce tree must be rejected before rm can see it.
  unsafe_path="$private/escaping-symlink"
  "$LN_BIN" -s "$canonical_tmp" "$unsafe_path"
  if safe_remove_nonce_tree "$private" "$unsafe_path"; then
    printf 'FAIL: escaping symlink path was accepted for deletion\n' >&2
    FAILURES=$((FAILURES + 1))
  else
    PASS=$((PASS + 1))
  fi
  if [[ -L "$unsafe_path" && "$(<"$host/kwinrc")" == "$host_before" ]]; then
    PASS=$((PASS + 1))
  else
    printf 'FAIL: escaping symlink changed the sentinel\n' >&2
    FAILURES=$((FAILURES + 1))
  fi
  "$RM_BIN" -f -- "$unsafe_path"

  "$MKDIR_BIN" -p "$SIGNAL_DISPOSABLE"
  if [[ "${FLOOR_RATIO_STATIC_TEST_PAUSE:-0}" == 1 ]]; then
    printf 'ready\n' > "$private/static-signal-ready"
    "$SLEEP_BIN" "$STATIC_PAUSE_SECONDS" & pause_pid=$!
    wait "$pause_pid"
  fi

  assert_value "$REQUIRED_KWIN_VERSION" "6.7.4" 'KWin suitability is pinned to exactly 6.7.4'
  assert_value "$REQUIRED_CHILD_PROCESSES" "1" 'the future attempt permits exactly one child process'
  assert_value "$MAX_ATTEMPTS" "1" 'the future attempt cap is exactly one'
  assert_value "$REQUIRED_LAYOUT" 'fixed-disposable-custom-tile' 'layout is fixed and disposable'
  assert_value "$REQUIRED_SOCKET" 'absolute-parent-wayland-socket' 'parent Wayland socket must be absolute'
  assert_value "$REQUIRED_XDG" 'private-xdg-homes-runtime-session-bus' 'XDG homes/runtime/session bus are private'
  assert_value "$REQUIRED_TIMEOUT" 'bounded' 'future execution timeout is bounded'
  assert_value "$REQUIRED_JOURNAL_SCOPE" 'fresh-cursor-same-child-pid-project-logs' 'journal scope is bounded'
  assert_value "$REQUIRED_PERSISTENCE" 'host-kwinrc-hash-mtime-before-after-private-persistence' 'persistence assertions are explicit'
  assert_value "$COMMAND_ALLOWLIST" 'kwin_wayland,busctl,journalctl,sha256sum,stat,timeout,mkdir,mktemp,rm,printf' 'future command allowlist is explicit'
  assert_value "$CLEANUP_ORDER" 'stop-child restore-persistence remove-private-roots retain-evidence' 'cleanup order is exact'

  for vector in "$CASE_SINGLE" "$CASE_MULTI" "$CASE_IMPOSSIBLE" "$CASE_MISMATCH"; do
    evidence="$private/evidence/$vector"
    "$MKDIR_BIN" -p "$evidence/disposable"
    if simulate_vector "$evidence" "$vector"; then
      PASS=$((PASS + 1))
    else
      printf 'FAIL: vector simulation failed: %s\n' "$vector" >&2
      FAILURES=$((FAILURES + 1))
    fi
    assert_file "$evidence/retained-evidence" "$vector evidence is retained after cleanup"
    if [[ ! -e "$evidence/disposable" ]]; then
      PASS=$((PASS + 1))
    else
      printf 'FAIL: %s disposable private root was not removed\n' "$vector" >&2
      FAILURES=$((FAILURES + 1))
    fi
    decode_count="$(<"$evidence/decode.count")"
    write_count="$(<"$evidence/write-count")"
    case "$vector" in
      "$CASE_SINGLE")
        assert_value 2 "$decode_count" 'single-ancestor-write fresh-decodes before and after mutation'
        assert_value 1 "$write_count" 'single-ancestor-write has one write'
        ;;
      "$CASE_MULTI")
        assert_value 3 "$decode_count" 'multi-ancestor-writes fresh-decodes after every mutation'
        assert_value 2 "$write_count" 'multi-ancestor-writes has two writes'
        ;;
      "$CASE_IMPOSSIBLE")
        assert_value 1 "$decode_count" 'impossible allocation has no post-mutation decode'
        assert_value 0 "$write_count" 'impossible allocation performs zero writes'
        ;;
      "$CASE_MISMATCH")
        assert_value 2 "$decode_count" 'post-write mismatch decodes freshly after the write'
        assert_value 1 "$write_count" 'post-write mismatch has only the candidate write'
        assert_file "$evidence/mismatch" 'post-write mismatch is recorded'
        ;;
    esac
    if [[ "$evidence" == "$private"/* ]]; then
      PASS=$((PASS + 1))
    else
      printf 'FAIL: evidence escaped the nonce-owned private root\n' >&2
      FAILURES=$((FAILURES + 1))
    fi
  done

  # The interrupted trace uses the same exact order and retains its evidence.
  evidence="$private/evidence/interrupted-run"
  "$MKDIR_BIN" -p "$evidence/disposable"
  cleanup_trace "$evidence" interrupted "$evidence/disposable"
  assert_cleanup_order "$evidence"
  assert_file "$evidence/retained-evidence" 'interrupted-run evidence is retained'
  if [[ ! -e "$evidence/disposable" ]]; then PASS=$((PASS + 1)); else printf 'FAIL: interrupted disposable private root was not removed\n' >&2; FAILURES=$((FAILURES + 1)); fi
  assert_value 'stop-reason=interrupted' "$(<"$evidence/retained-evidence")" 'interrupted run records its stop reason'

  assert_value "$host_before" "$(<"$host/kwinrc")" 'host sentinel remains untouched'
  assert_file "$SCRIPT_DIR/../test-fixtures/floor-ratio-evidence.schema.json" 'strict static-contract schema exists'
  assert_file "$SCRIPT_DIR/../test-fixtures/floor-ratio-evidence.json" 'static-contract fixture exists'
  if [[ "${FLOOR_RATIO_FORCE_STATIC_FAILURE:-0}" == 1 ]]; then
    printf 'FAIL: forced static-failure retention check\n' >&2
    FAILURES=$((FAILURES + 1))
  fi

  printf 'static-self-test: vectors=4 private-root=%s\n' "$private"
  printf 'static-contract-fixture: no proof executed; live evidence authenticity is not asserted\n'
  printf 'future authorized live implementation must enforce dependency, PID, persistence, journal, and cleanup requirements\n'
  printf 'passes: %s failures: %s\n' "$PASS" "$FAILURES"
  [[ "$FAILURES" -eq 0 ]]
}

future_live_proof_refusal() {
  printf 'refusing execution: live-proof is documentation-only; no live execution exists\n' >&2
  printf 'no dependencies or capabilities were checked, and no proof passed\n' >&2
  printf 'required additional authorization: a separate user authorization is required\n' >&2
  printf 'required gates: kwin=%s child-processes=%s layout=%s socket=%s xdg=%s timeout=%s journal=%s persistence=%s cleanup=%s allowlist=%s\n' \
    "$REQUIRED_KWIN_VERSION" "$REQUIRED_CHILD_PROCESSES" "$REQUIRED_LAYOUT" "$REQUIRED_SOCKET" "$REQUIRED_XDG" "$REQUIRED_TIMEOUT" "$REQUIRED_JOURNAL_SCOPE" "$REQUIRED_PERSISTENCE" "$CLEANUP_ORDER" "$COMMAND_ALLOWLIST" >&2
  return 1
}

parse_live_proof_refusal() {
  local vector authorization
  [[ "$#" -eq 3 ]] || return 1
  [[ "$1" == '--case' ]] || return 1
  vector="$2"
  case "$vector" in
    "$CASE_SINGLE"|"$CASE_MULTI"|"$CASE_IMPOSSIBLE"|"$CASE_MISMATCH") ;;
    *) return 1 ;;
  esac
  case "$3" in
    --mutation-authorized=*) authorization="${3#--mutation-authorized=}" ;;
    *) return 1 ;;
  esac
  [[ "$authorization" == "$AUTHORIZATION" ]] || return 1
  future_live_proof_refusal || true
  return 0
}

if [[ "$#" -eq 0 ]]; then
  usage >&2
  exit 1
fi

case "$1" in
  --help|-h)
    [[ "$#" -eq 1 ]] || { printf 'error: help takes no arguments\n' >&2; exit 1; }
    usage
    exit 0
    ;;
  static-self-test)
    [[ "$#" -eq 1 ]] || { printf 'error: static-self-test takes no arguments\n' >&2; exit 1; }
    static_self_test
    ;;
  live-proof)
    if parse_live_proof_refusal "${@:2}"; then
      exit 1
    fi
    printf 'error: live-proof requires exactly --case <one exact vector> and --mutation-authorized=%s; refusing\n' "$AUTHORIZATION" >&2
    exit 1
    ;;
  *)
    printf 'error: unknown command or unsupported static command: %s\n' "$1" >&2
    exit 1
    ;;
esac
