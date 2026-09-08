#!/usr/bin/env bash
# Retained manually invokable disabled-by-default shadow lifecycle command.
#
# Single explicit journey only: `run` drives one shadow transport through the
# shared exact lifecycle (shadow builder + shadow loader host + one exact
# Planner child) under one fresh namespaced runtime dir. Static checks and
# fake-command tests cover the contract; live use needs SHADOW_LIFECYCLE_ALLOW=1
# and the exact repo resources below. Production can never reach shadow here:
# only this file (plus its focused fake tests) selects shadow mode, via the
# thin shadow builder/host wrappers; default builder/loader invocations stay
# advisory with byte-identical outputs.
#
# Order (strict, no duplicates, event-driven bounded waits via the loader):
#   1. run the shared loader resource-free source-only preflight (exact
#      source/tool identities, current KWin identity with recapture,
#      production loaded, shadow absent, Planner absent) before ANY
#      lifecycle-created file, dir, build output, input, receipt, or runtime
#      namespace exists.
#   2. bootstrap the identity-only record, build the exact shadow bundle
#      through the shared builder, run the shared loader full deterministic
#      preflight plus builder verify (current KWin identity, production
#      loaded, shadow absent, Planner absent). The fresh namespaced runtime
#      dir is created only after that full preflight/verify passes.
#   3. stage one valid identity-only record/bundle under the fresh dir with
#      the fixed shadow bundle/manifest names.
#   4. launch exactly one Planner child (`planner-service`), pin PID/start-tick/
#      exe identity, resolve and pin the unique D-Bus owner/PID, reject
#      collision/replacement. No restart.
#   5. shadow via loader start with --expected-planner-owner (receipt requires
#      correlated bounded source/ready/result/after where match|divergence
#      pairs only with after true), loader diagnostics, loader stop (exact
#      unload of the recorded object/plugin), then exact Planner stop and
#      unique-owner loss proof before removing the known namespace.
# Cleanup covers every partial phase through known IDs only (loader receipt,
# exact Planner identity, current fresh dir, generated artifacts). Identity/
# cleanup ambiguity preserves the exact residue and fails. Prior shadow residue
# is never scanned or touched, and no machine data is retained in the repo.
#
# usage: shadow-lifecycle.sh <run|--help>
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
: "${SHADOW_LIFECYCLE_ALLOW:=0}"
: "${SHADOW_LIFECYCLE_TEST_FAKE:=0}"
: "${SHADOW_LOADER:=$REPO_ROOT/scripts/shadow-describe.sh}"
: "${SHADOW_BUILDER:=$REPO_ROOT/scripts/shadow-describe-build.mjs}"
: "${SHADOW_DIST_DIR:=$REPO_ROOT/kwin/dist}"
: "${PLANNER_BIN:=}"
: "${BUSCTL_BIN:=busctl}"
: "${NODE_BIN:=node}"
: "${SHA256SUM_BIN:=sha256sum}"
: "${KILL_BIN:=kill}"
: "${SLEEP_BIN:=sleep}"
: "${READLINK_BIN:=readlink}"
: "${STAT_BIN:=stat}"
: "${PROC_ROOT:=/proc}"
: "${SHADOW_ATTEMPTS:=50}"
: "${SHADOW_DELAY:=0.1}"
: "${SHADOW_STOP_ATTEMPTS:=50}"
: "${SHADOW_LIFECYCLE_TEST_HOOK_AFTER_PIN:=}"
: "${SHADOW_LIFECYCLE_TEST_HOOK_BEFORE_STOP:=}"

EXACT_LOADER="$REPO_ROOT/scripts/shadow-describe.sh"
EXACT_BUILDER="$REPO_ROOT/scripts/shadow-describe-build.mjs"
EXACT_DIST_DIR="$REPO_ROOT/kwin/dist"
SEQ_OWNER="shadow-lifecycle-owner"
SEQ_GENERATION="shadow-lifecycle-gen"
SEQ_REVISION="7"
PLANNER_SERVICE="org.plasmaautotiler.Planner"
KWIN_SERVICE="org.kde.KWin"

RUNDIR=""
BUILT_DIST="0"
PLANNER_PID=""
PLANNER_TICK=""
PLANNER_EXE=""
PLANNER_CANON=""
PLANNER_OWNER=""
PRESERVE_RESIDUE="0"
SHADOW_DIAG_MAX_BYTES=2048

# Smallest reusable lifecycle observability: bound, redact, and emit causal
# invocation-tied stderr/exit classification to stderr before exact cleanup
# erases RUNDIR. Redacts unique bus owners, numeric native PIDs, hex
# correlations, and absolute paths, and encodes newlines so every diagnostic
# stays one bounded log record; the caller supplies invocation plus
# correlation so diagnostics stay tied without leaking native IDs. Cleanup
# ordering and exact behavior below are unchanged; emitters run before
# cleanup_all.
shadow_redact_text() {
  local _in="${1:-}" _out=""
  _out="$(printf '%s' "$_in" | head -c "$SHADOW_DIAG_MAX_BYTES" | sed -E -e 's/:[0-9]+\.[0-9]+/:REDACTED/g' -e 's/[0-9a-f]{32,128}/REDACTED_HEX/g' -e 's|/[^[:space:]"]+|REDACTED_PATH|g' -e 's/\b(pid|PID)([[:space:]]+)[0-9][0-9]*/\1\2REDACTED_PID/g' -e 's/\b[0-9]{4,}\b/REDACTED_NUM/g')"
  _out="${_out//$'\n'/\\n}"
  _out="${_out//$'\r'/\\r}"
  printf '%s' "$_out" | head -c "$SHADOW_DIAG_MAX_BYTES"
}

shadow_emit_diag() {
  local invocation="${1:-unknown}" exit_code="${2:-1}" correlation="${3:-none}" raw="${4:-}"
  local redacted=""
  redacted="$(shadow_redact_text "$raw")"
  printf 'diag: invocation=%s exit=%s correlation=%s stderr=%s\n' "$invocation" "$exit_code" "$correlation" "$redacted" >&2
}

# Smallest reusable bounded in-memory file tail for causal diagnostics.
# Reads at most SHADOW_DIAG_MAX_BYTES without creating temp files.
shadow_file_tail() {
  tail -c "$SHADOW_DIAG_MAX_BYTES" -- "${1:-}" 2>/dev/null || true
}

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'EOF'
usage: shadow-lifecycle.sh <run|--help>

Retained manually invokable disabled-by-default shadow lifecycle. Disabled
unless SHADOW_LIFECYCLE_ALLOW=1. One journey only: run drives a single shadow
transport (match|divergence with after true) through the shared exact builder
plus shared exact loader plus one exact Planner child under one fresh
namespaced runtime dir. No other command exists.
EOF
}

require_allow() {
  [[ "${SHADOW_LIFECYCLE_ALLOW:-0}" == "1" ]] || {
    printf 'error: shadow lifecycle is disabled by default (set SHADOW_LIFECYCLE_ALLOW=1 for the authorized manual pass)\n' >&2
    exit 1
  }
}

test_fake_gate() {
  [[ "${SHADOW_LIFECYCLE_TEST_FAKE:-0}" == "1" ]]
}

safe_abs() {
  local path="$1"
  [[ "$path" == /* && "$path" != *'//' && "$path" != *'/../'* \
    && "$path" != */.. && "$path" != */./* && "$path" != */. ]] || return 1
  [[ "$path" != "/" ]] || return 1
}

# Production pins the exact repo shadow loader/builder/dist; any override is an
# explicit test-only fake and requires the fake gate.
resolve_pinned_path() {
  local value="$1" exact="$2" label="$3"
  if [[ "$value" == "$exact" ]]; then
    printf '%s' "$value"
    return 0
  fi
  test_fake_gate || {
    printf 'error: %s override is test-only (requires SHADOW_LIFECYCLE_TEST_FAKE=1): %s\n' "$label" "$value" >&2
    return 1
  }
  safe_abs "$value" || {
    printf 'error: %s override is unsafe: %s\n' "$label" "$value" >&2
    return 1
  }
  printf '%s' "$value"
}

require_proc_root() {
  if [[ "${PROC_ROOT:-/proc}" != /proc ]]; then
    test_fake_gate || {
      printf 'error: PROC_ROOT must be /proc in production (synthetic roots require SHADOW_LIFECYCLE_TEST_FAKE=1)\n' >&2
      return 1
    }
    safe_abs "$PROC_ROOT" || {
      printf 'error: PROC_ROOT is unsafe: %s\n' "$PROC_ROOT" >&2
      return 1
    }
  fi
}

proc_start_tick() {
  local pid="$1" stat_line="" stat_pid="" rest=""
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  stat_line="$(<"$PROC_ROOT/$pid/stat")" || return 1
  [[ "$stat_line" != *$'\n'* ]] || return 1
  stat_pid="${stat_line%% *}"
  [[ "$stat_pid" == "$pid" ]] || return 1
  rest="${stat_line##*) }"
  [[ "$rest" != "$stat_line" ]] || return 1
  local -a fields=()
  read -r -a fields <<<"$rest" || return 1
  [[ "${#fields[@]}" -ge 20 && "${fields[0]:-}" =~ ^[A-Za-z]$ ]] || return 1
  [[ "${fields[0]}" != "Z" ]] || return 1
  [[ "${fields[19]:-}" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s' "${fields[19]}"
}

proc_exe() {
  local pid="$1" target=""
  target="$("$READLINK_BIN" "$PROC_ROOT/$pid/exe" 2>/dev/null)" || return 1
  [[ -n "$target" && "$target" == /* ]] || return 1
  [[ "$target" != *' (deleted)'* ]] || return 1
  printf '%s' "$target"
}

canonical_path() {
  local path="$1" canon=""
  safe_abs "$path" || return 1
  canon="$("$READLINK_BIN" -f -- "$path" 2>/dev/null)" || return 1
  safe_abs "$canon" || return 1
  printf '%s' "$canon"
}

test_hook() {
  local point="$1" hook=""
  if [[ "$point" == "after-pin" ]]; then hook="$SHADOW_LIFECYCLE_TEST_HOOK_AFTER_PIN";
  elif [[ "$point" == "before-stop" ]]; then hook="$SHADOW_LIFECYCLE_TEST_HOOK_BEFORE_STOP";
  else return 0; fi
  [[ -n "$hook" ]] || return 0
  test_fake_gate || {
    printf 'error: lifecycle test hook is test-only (requires SHADOW_LIFECYCLE_TEST_FAKE=1)\n' >&2
    return 1
  }
  [[ -f "$hook" && ! -L "$hook" ]] || {
    printf 'error: lifecycle test hook is unavailable: %s\n' "$hook" >&2
    return 1
  }
  bash -- "$hook" "$point" || {
    printf 'error: lifecycle test hook failed at %s\n' "$point" >&2
    return 1
  }
}

# Strict busctl --json=short boolean/name/PID readers (unique names only).
bus_bool() {
  BUS_JSON="$1" "$NODE_BIN" -e '
const raw = process.env.BUS_JSON || "";
let v;
try { v = JSON.parse(raw); } catch (e) { process.exit(1); }
if (typeof v !== "object" || v === null || Array.isArray(v)) process.exit(1);
if (v.type !== "b" || !Array.isArray(v.data) || v.data.length !== 1 || typeof v.data[0] !== "boolean") process.exit(1);
process.stdout.write(v.data[0] ? "true" : "false");
' 2>/dev/null
}

bus_unique_name() {
  BUS_JSON="$1" "$NODE_BIN" -e '
const raw = process.env.BUS_JSON || "";
let v;
try { v = JSON.parse(raw); } catch (e) { process.exit(1); }
if (typeof v !== "object" || v === null || Array.isArray(v)) process.exit(1);
if (v.type !== "s" || !Array.isArray(v.data) || v.data.length !== 1 || typeof v.data[0] !== "string") process.exit(1);
if (!/^:[0-9]+\.[0-9]+$/.test(v.data[0])) process.exit(1);
process.stdout.write(v.data[0]);
' 2>/dev/null
}

bus_unix_pid() {
  BUS_JSON="$1" "$NODE_BIN" -e '
const raw = process.env.BUS_JSON || "";
let v;
try { v = JSON.parse(raw); } catch (e) { process.exit(1); }
if (typeof v !== "object" || v === null || Array.isArray(v)) process.exit(1);
if (v.type !== "u" || !Array.isArray(v.data) || v.data.length !== 1 || !Number.isInteger(v.data[0])) process.exit(1);
if (!/^[1-9][0-9]*$/.test(String(v.data[0]))) process.exit(1);
process.stdout.write(String(v.data[0]));
' 2>/dev/null
}

planner_absent_check() {
  local out="" has="" _rc=0
  out="$("$BUSCTL_BIN" --user --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus NameHasOwner s "$PLANNER_SERVICE" 2>&1)" || _rc=$?
  if [[ "$_rc" -ne 0 ]]; then
    shadow_emit_diag "bus:NameHasOwner" "$_rc" "none" "$out"
    printf 'error: planner absence check failed (transport failure)\n' >&2
    return 1
  fi
  has="$(bus_bool "$out")" || {
    printf 'error: malformed NameHasOwner reply for %s\n' "$PLANNER_SERVICE" >&2
    return 1
  }
  [[ "$has" == "false" ]] || {
    printf 'error: planner service %s is present; refusing coexistence collision\n' "$PLANNER_SERVICE" >&2
    return 1
  }
}

resolve_service_owner_pid() {
  local service="$1" owner="" pid=""
  local out="" _rc=0
  out="$("$BUSCTL_BIN" --user --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s "$service" 2>&1)" || _rc=$?
  if [[ "$_rc" -ne 0 ]]; then
    shadow_emit_diag "bus:GetNameOwner" "$_rc" "none" "$out"
    printf 'error: GetNameOwner failed for %s\n' "$service" >&2
    return 1
  fi
  owner="$(bus_unique_name "$out")" || {
    printf 'error: malformed GetNameOwner reply for %s\n' "$service" >&2
    return 1
  }
  out=""; _rc=0
  out="$("$BUSCTL_BIN" --user --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetConnectionUnixProcessID s "$owner" 2>&1)" || _rc=$?
  if [[ "$_rc" -ne 0 ]]; then
    shadow_emit_diag "bus:GetConnectionUnixProcessID" "$_rc" "none" "$out"
    printf 'error: could not resolve the Unix PID for %s owner %s\n' "$service" "$owner" >&2
    return 1
  fi
  pid="$(bus_unix_pid "$out")" || {
    printf 'error: malformed GetConnectionUnixProcessID reply for %s\n' "$service" >&2
    return 1
  }
  printf '%s %s' "$owner" "$pid"
}

nonce_new() {
  local tag="$1" nonce=""
  nonce="$("$SHA256SUM_BIN" <<<"$RANDOM-$$-$(date +%s%N)-$tag" 2>/dev/null | cut -d' ' -f1 | head -c 64)" || return 1
  [[ "$nonce" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s' "$nonce"
}

# Identity-only shadow request record: exactly nonce/correlationId/owner/
# generation/revision with correlation equal to the nonce. No snapshot,
# intent, capabilities, geometry, or window ids; the observation always comes
# from the live trio capture inside the shadow bundle.
write_request_json() {
  local file="$1" nonce="$2"
  REQ_FILE="$file" REQ_NONCE="$nonce" REQ_OWNER="$SEQ_OWNER" REQ_GENERATION="$SEQ_GENERATION" REQ_REVISION="$SEQ_REVISION" \
    "$NODE_BIN" -e '
const fs = require("node:fs");
const record = {
  nonce: process.env.REQ_NONCE,
  correlationId: process.env.REQ_NONCE,
  owner: process.env.REQ_OWNER,
  generation: process.env.REQ_GENERATION,
  revision: Number(process.env.REQ_REVISION),
};
fs.writeFileSync(process.env.REQ_FILE, JSON.stringify(record));
' || {
    printf 'error: could not write the request record: %s\n' "$file" >&2
    return 1
  }
}

loader_preflight() {
  local loader="$1" bundle="$2" manifest="$3" input="$4"
  shift 4
  "$loader" preflight --bundle "$bundle" --manifest "$manifest" --input "$input" "$@"
}

loader_start() {
  local loader="$1"
  shift
  "$loader" start "$@"
}

# Exact Planner stop bound to the pinned PID/start-tick/exe. Any drift or
# signal ambiguity preserves the residue and fails.
exact_planner_stop() {
  [[ -n "$PLANNER_PID" ]] || {
    printf 'error: no pinned planner identity to stop\n' >&2
    return 1
  }
  test_hook "before-stop" || return 1
  local live_tick="" live_exe="" live_canon=""
  live_tick="$(proc_start_tick "$PLANNER_PID")" || {
    printf 'error: planner PID %s is stale or unreadable; preserving residue %s\n' "$PLANNER_PID" "$RUNDIR" >&2
    PRESERVE_RESIDUE="1"
    return 1
  }
  [[ "$live_tick" == "$PLANNER_TICK" ]] || {
    printf 'error: planner PID/start-tick drift detected; preserving residue %s\n' "$RUNDIR" >&2
    PRESERVE_RESIDUE="1"
    return 1
  }
  live_exe="$(proc_exe "$PLANNER_PID")" || {
    printf 'error: planner executable identity is unreadable; preserving residue %s\n' "$RUNDIR" >&2
    PRESERVE_RESIDUE="1"
    return 1
  }
  live_canon="$(canonical_path "$live_exe")" || {
    printf 'error: planner live executable does not canonicalize; preserving residue %s\n' "$RUNDIR" >&2
    PRESERVE_RESIDUE="1"
    return 1
  }
  [[ "$live_canon" == "$PLANNER_CANON" ]] || {
    printf 'error: planner executable replacement detected; preserving residue %s\n' "$RUNDIR" >&2
    PRESERVE_RESIDUE="1"
    return 1
  }
  "$KILL_BIN" -TERM -- "$PLANNER_PID" 2>/dev/null || {
    printf 'error: could not signal the pinned planner PID %s; preserving residue %s\n' "$PLANNER_PID" "$RUNDIR" >&2
    PRESERVE_RESIDUE="1"
    return 1
  }
  local attempt=0
  while [[ "$attempt" -lt "$SHADOW_STOP_ATTEMPTS" ]]; do
    if ! "$KILL_BIN" -0 -- "$PLANNER_PID" 2>/dev/null; then
      PLANNER_PID=""
      return 0
    fi
    "$SLEEP_BIN" "$SHADOW_DELAY" >/dev/null 2>&1 || return 1
    attempt=$((attempt + 1))
  done
  if "$KILL_BIN" -0 -- "$PLANNER_PID" 2>/dev/null; then
    printf 'error: pinned planner PID %s did not exit after exact TERM; preserving residue %s\n' "$PLANNER_PID" "$RUNDIR" >&2
    PRESERVE_RESIDUE="1"
    return 1
  fi
  PLANNER_PID=""
  return 0
}

prove_planner_owner_loss() {
  local out="" has="" _rc=0
  out="$("$BUSCTL_BIN" --user --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus NameHasOwner s "$PLANNER_SERVICE" 2>&1)" || _rc=$?
  if [[ "$_rc" -ne 0 ]]; then
    shadow_emit_diag "bus:NameHasOwner-loss" "$_rc" "none" "$out"
    printf 'error: planner owner-loss check failed (transport failure)\n' >&2
    return 1
  fi
  has="$(bus_bool "$out")" || {
    printf 'error: malformed NameHasOwner reply for %s\n' "$PLANNER_SERVICE" >&2
    return 1
  }
  [[ "$has" == "false" ]] || {
    printf 'error: planner service %s is still owned; refusing shadow acceptance\n' "$PLANNER_SERVICE" >&2
    return 1
  }
  # NameHasOwner proves well-known-name loss. Re-querying the pinned unique
  # owner avoids global enumeration and strictly parses its exact absence.
  [[ "$PLANNER_OWNER" =~ ^:[0-9]+\.[0-9]+$ ]] || {
    printf 'error: pinned planner owner is malformed for loss proof\n' >&2
    return 1
  }
  local owner_out="" owner_has="" _owner_rc=0
  owner_out="$("$BUSCTL_BIN" --user --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus NameHasOwner s "$PLANNER_OWNER" 2>&1)" || _owner_rc=$?
  if [[ "$_owner_rc" -ne 0 ]]; then
    shadow_emit_diag "bus:NameHasOwner-unique-loss" "$_owner_rc" "none" "$owner_out"
    printf 'error: planner unique-owner loss check failed (transport failure)\n' >&2
    return 1
  fi
  owner_has="$(bus_bool "$owner_out")" || {
    printf 'error: malformed NameHasOwner reply for pinned planner owner\n' >&2
    return 1
  }
  if [[ "$owner_has" != "false" ]]; then
    printf 'error: pinned planner owner %s is still present; refusing shadow acceptance\n' "$PLANNER_OWNER" >&2
    return 1
  fi
  return 0
}

cleanup_generated() {
  if [[ "$BUILT_DIST" == "1" ]]; then
    rm -f -- "$SHADOW_DIST_DIR/shadow-describe.js" "$SHADOW_DIST_DIR/shadow-describe.manifest.json" 2>/dev/null || true
  fi
}

cleanup_all() {
  local loader="$1"
  local receipt=""
  for receipt in "${SHADOW_RECEIPT:-}" "$RUNDIR/shadow/receipt.json"; do
    [[ -n "$receipt" ]] || continue
    if [[ -e "$receipt" || -L "$receipt" ]]; then
      "$loader" stop --receipt "$receipt" >/dev/null 2>&1 || {
        PRESERVE_RESIDUE="1"
      }
    fi
  done
  if [[ -n "$PLANNER_PID" ]]; then
    exact_planner_stop >/dev/null 2>&1 || {
      PRESERVE_RESIDUE="1"
    }
  fi
  cleanup_generated
  if [[ "$PRESERVE_RESIDUE" == "1" ]]; then
    printf 'error: ambiguous identity or cleanup; preserving exact residue: %s\n' "$RUNDIR" >&2
    return 1
  fi
  if [[ -n "$RUNDIR" && -d "$RUNDIR" ]]; then
    rm -rf -- "$RUNDIR" 2>/dev/null || {
      printf 'error: could not remove the fresh runtime dir: %s\n' "$RUNDIR" >&2
      return 1
    }
  fi
  RUNDIR=""
  return 0
}

cmd_run() {
  [[ $# -eq 0 ]] || fail "run takes no arguments"
  require_allow
  require_proc_root || exit 1
  command -v "$NODE_BIN" >/dev/null 2>&1 || fail "required tool '$NODE_BIN' not found in PATH"
  command -v "$BUSCTL_BIN" >/dev/null 2>&1 || fail "required tool '$BUSCTL_BIN' not found in PATH"
  local loader="" builder="" dist=""
  loader="$(resolve_pinned_path "$SHADOW_LOADER" "$EXACT_LOADER" "loader")" || exit 1
  builder="$(resolve_pinned_path "$SHADOW_BUILDER" "$EXACT_BUILDER" "builder")" || exit 1
  dist="$(resolve_pinned_path "$SHADOW_DIST_DIR" "$EXACT_DIST_DIR" "dist dir")" || exit 1
  [[ -f "$loader" && ! -L "$loader" ]] || fail "loader is unavailable: $loader"
  [[ -f "$builder" && ! -L "$builder" ]] || fail "builder is unavailable: $builder"
  [[ -d "$dist" && ! -L "$dist" ]] || fail "dist dir is unavailable: $dist"
  [[ "$SHADOW_ATTEMPTS" =~ ^(0|[1-9][0-9]*)$ && "$SHADOW_ATTEMPTS" -ge 1 && "$SHADOW_ATTEMPTS" -le 500 ]] || fail "invalid SHADOW_ATTEMPTS (1..500)"
  local NONCE=""
  NONCE="$(nonce_new shadow)" || fail "could not generate the shadow correlation"
  [[ "$NONCE" =~ ^[0-9a-f]{64}$ ]] || fail "shadow correlation is malformed"

  # Resource-free shadow preflight before ANY lifecycle-created file, dir,
  # build output, input, receipt, or runtime namespace. Validates exact
  # source/tool identities plus KWin identity, production loaded, shadow
  # absent, Planner absent, with recapture. Creates nothing; failure stops
  # before any mktemp/build/mkdir.
  local _source_preflight_raw="" _source_preflight_rc=0
  _source_preflight_raw="$("$loader" preflight-source-only 2>&1)" || _source_preflight_rc=$?
  if [[ "$_source_preflight_rc" -ne 0 ]]; then
    shadow_emit_diag "preflight:source-only" "$_source_preflight_rc" "$NONCE" "$_source_preflight_raw"
    fail "source-only loader preflight failed"
  fi
  [[ -n "$_source_preflight_raw" ]] || fail "source-only loader preflight emitted no identity"
  shadow_emit_diag "preflight:source-only" "0" "$NONCE" "$_source_preflight_raw"
  if [[ -e "$dist/shadow-describe.js" || -L "$dist/shadow-describe.js" || -e "$dist/shadow-describe.manifest.json" || -L "$dist/shadow-describe.manifest.json" ]]; then
    fail "exact shadow build output collision; refusing to overwrite"
  fi

  # Bootstrap: stage the identity-only input outside the fresh dir, build the
  # exact shadow bundle, and pass the shared loader full deterministic
  # preflight plus builder verify (current KWin identity, production loaded,
  # shadow absent, Planner absent) before any runtime dir exists.
  local BOOTSTRAP_INPUT=""
  BOOTSTRAP_INPUT="$(mktemp "${TMPDIR:-/tmp}/shadow-lifecycle-bootstrap-XXXXXX.json")" || fail "could not stage the bootstrap input"
  write_request_json "$BOOTSTRAP_INPUT" "$NONCE" || {
    rm -f -- "$BOOTSTRAP_INPUT"
    exit 1
  }
  local _bootstrap_raw="" _bootstrap_rc=0
  _bootstrap_raw="$("$NODE_BIN" -- "$builder" --input "$BOOTSTRAP_INPUT" --out "$dist/shadow-describe.js" 2>&1)" || _bootstrap_rc=$?
  if [[ "$_bootstrap_rc" -ne 0 ]]; then
    shadow_emit_diag "build:bootstrap" "$_bootstrap_rc" "$NONCE" "$_bootstrap_raw"
    rm -f -- "$BOOTSTRAP_INPUT"
    cleanup_generated
    fail "bootstrap builder failed"
  fi
  if [[ -n "$_bootstrap_raw" ]]; then
    shadow_emit_diag "build:bootstrap" "0" "$NONCE" "$_bootstrap_raw"
  fi
  BUILT_DIST="1"
  local PREFLIGHT_BEFORE="" _preflight_raw="" _preflight_rc=0
  _preflight_raw="$(loader_preflight "$loader" "$dist/shadow-describe.js" "$dist/shadow-describe.manifest.json" "$BOOTSTRAP_INPUT" 2>&1)" || _preflight_rc=$?
  if [[ "$_preflight_rc" -ne 0 ]]; then
    shadow_emit_diag "preflight:bootstrap" "$_preflight_rc" "$NONCE" "$_preflight_raw"
    rm -f -- "$BOOTSTRAP_INPUT"
    cleanup_generated
    fail "bootstrap loader preflight failed"
  fi
  PREFLIGHT_BEFORE="$_preflight_raw"
  [[ -n "$PREFLIGHT_BEFORE" ]] || {
    cleanup_generated
    fail "bootstrap loader preflight emitted no identity"
  }
  local _verify_raw="" _verify_rc=0
  _verify_raw="$("$NODE_BIN" -- "$builder" --verify --input "$BOOTSTRAP_INPUT" --bundle "$dist/shadow-describe.js" --manifest "$dist/shadow-describe.manifest.json" 2>&1)" || _verify_rc=$?
  if [[ "$_verify_rc" -ne 0 ]]; then
    shadow_emit_diag "verify:bootstrap" "$_verify_rc" "$NONCE" "$_verify_raw"
    rm -f -- "$BOOTSTRAP_INPUT"
    cleanup_generated
    fail "bootstrap builder verify failed"
  fi
  if [[ -n "$_verify_raw" ]]; then
    shadow_emit_diag "verify:bootstrap" "0" "$NONCE" "$_verify_raw"
  fi
  rm -f -- "$BOOTSTRAP_INPUT"

  # One fresh namespaced runtime dir, only after the preflight/verify above
  # passed. Fresh high-entropy runtime token in memory; the exact path is
  # composed before creation and retained as the lifecycle-bound identity
  # before mkdir creates it. Collision/create failure stops before lifecycle
  # and never deletes the exact path.
  local RUNDIR_PARENT=""
  RUNDIR_PARENT="${TMPDIR:-/tmp}"
  safe_abs "$RUNDIR_PARENT" && [[ -d "$RUNDIR_PARENT" && ! -L "$RUNDIR_PARENT" ]] || {
    cleanup_generated
    fail "fresh runtime parent is unsafe"
  }
  local RUNDIR_TOKEN=""
  RUNDIR_TOKEN="$("$NODE_BIN" -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))' 2>/dev/null)" || {
    cleanup_generated
    fail "could not generate the fresh runtime token"
  }
  [[ "$RUNDIR_TOKEN" =~ ^[0-9a-f]{64}$ ]] || {
    cleanup_generated
    fail "fresh runtime token is malformed"
  }
  RUNDIR="$RUNDIR_PARENT/shadow-transport-$RUNDIR_TOKEN"
  safe_abs "$RUNDIR" || {
    cleanup_generated
    fail "fresh runtime path is unsafe"
  }
  [[ ! -e "$RUNDIR" && ! -L "$RUNDIR" ]] || {
    cleanup_generated
    fail "fresh runtime dir collision; refusing to reuse the exact path"
  }
  mkdir -- "$RUNDIR" || {
    cleanup_generated
    fail "could not create the fresh runtime dir"
  }
  chmod 700 -- "$RUNDIR" || {
    cleanup_generated
    rmdir -- "$RUNDIR" 2>/dev/null || fail "could not lock the fresh runtime dir and exact cleanup failed"
    RUNDIR=""
    fail "could not lock the fresh runtime dir"
  }
  local RUNDIR_MODE=""
  RUNDIR_MODE="$("$STAT_BIN" -c '%a' -- "$RUNDIR" 2>/dev/null)" || {
    cleanup_generated
    rmdir -- "$RUNDIR" 2>/dev/null || fail "could not stat the fresh runtime dir and exact cleanup failed"
    RUNDIR=""
    fail "could not stat the fresh runtime dir"
  }
  [[ "$RUNDIR_MODE" == "700" ]] || {
    cleanup_generated
    rmdir -- "$RUNDIR" 2>/dev/null || fail "fresh runtime dir mode is $RUNDIR_MODE, expected 700; exact cleanup failed"
    RUNDIR=""
    fail "fresh runtime dir mode is $RUNDIR_MODE, expected 700"
  }
  local SHADOW_RECEIPT="$RUNDIR/shadow/receipt.json"

  # Pin the current KWin identity for continuity.
  local KWIN_PIN=""
  KWIN_PIN="$(resolve_service_owner_pid "$KWIN_SERVICE")" || {
    cleanup_all "$loader" || true
    fail "KWin owner/PID resolution failed"
  }
  local KWIN_OWNER="${KWIN_PIN%% *}" KWIN_PID="${KWIN_PIN##* }"
  [[ "$KWIN_OWNER" =~ ^:[0-9]+\.[0-9]+$ && "$KWIN_PID" =~ ^[1-9][0-9]*$ ]] || {
    cleanup_all "$loader" || true
    fail "KWin identity is ambiguous"
  }
  local KWIN_TICK=""
  KWIN_TICK="$(proc_start_tick "$KWIN_PID")" || {
    cleanup_all "$loader" || true
    fail "KWin PID is stale or unreadable"
  }

  # One valid identity-only record/bundle under the fresh dir only.
  local S_DIR="$RUNDIR/shadow"
  mkdir -p -- "$S_DIR" || {
    cleanup_all "$loader" || true
    fail "could not stage phase dir: shadow"
  }
  local S_INPUT="$S_DIR/request.json"
  local S_BUNDLE="$S_DIR/shadow-describe.js"
  local S_MANIFEST="$S_DIR/shadow-describe.manifest.json"
  local S_DIAG="$S_DIR/diag.log"
  write_request_json "$S_INPUT" "$NONCE" || {
    cleanup_all "$loader" || true
    fail "shadow bundle build failed"
  }
  local _build_raw="" _build_rc=0
  _build_raw="$("$NODE_BIN" -- "$builder" --input "$S_INPUT" --out "$dist/shadow-describe.js" 2>&1)" || _build_rc=$?
  if [[ "$_build_rc" -ne 0 ]]; then
    shadow_emit_diag "build:shadow" "$_build_rc" "$NONCE" "$_build_raw"
    cleanup_all "$loader" || true
    fail "shadow bundle build failed"
  fi
  if [[ -n "$_build_raw" ]]; then
    shadow_emit_diag "build:shadow" "0" "$NONCE" "$_build_raw"
  fi
  cp -p -- "$dist/shadow-describe.js" "$S_BUNDLE" || {
    cleanup_all "$loader" || true
    fail "could not stage the bundle for phase shadow"
  }
  cp -p -- "$dist/shadow-describe.manifest.json" "$S_MANIFEST" || {
    cleanup_all "$loader" || true
    fail "could not stage the manifest for phase shadow"
  }
  grep -Fq -- "\"correlationId\":\"$NONCE\"" "$S_MANIFEST" || {
    cleanup_all "$loader" || true
    fail "staged manifest does not bind phase shadow correlation"
  }
  : > "$S_DIAG" || {
    cleanup_all "$loader" || true
    fail "could not create the shadow diag file"
  }

  # One Planner child only. Collision fails.
  planner_absent_check || {
    cleanup_all "$loader" || true
    exit 1
  }
  local PLANNER_BIN_RESOLVED=""
  if [[ -n "$PLANNER_BIN" ]]; then
    PLANNER_BIN_RESOLVED="$PLANNER_BIN"
  elif [[ -x "$REPO_ROOT/target/debug/plasma-auto-tiler" ]]; then
    PLANNER_BIN_RESOLVED="$REPO_ROOT/target/debug/plasma-auto-tiler"
  elif [[ -x "$REPO_ROOT/target/release/plasma-auto-tiler" ]]; then
    PLANNER_BIN_RESOLVED="$REPO_ROOT/target/release/plasma-auto-tiler"
  else
    cleanup_all "$loader" || true
    fail "planner binary not found (set PLANNER_BIN or build plasma-auto-tiler)"
  fi
  if test_fake_gate; then
    [[ -x "$PLANNER_BIN_RESOLVED" && ! -d "$PLANNER_BIN_RESOLVED" ]] || {
      cleanup_all "$loader" || true
      fail "planner binary is missing or not executable: $PLANNER_BIN_RESOLVED"
    }
  else
    safe_abs "$PLANNER_BIN_RESOLVED" || {
      cleanup_all "$loader" || true
      fail "planner path is not an absolute safe path: $PLANNER_BIN_RESOLVED"
    }
    [[ -x "$PLANNER_BIN_RESOLVED" && ! -d "$PLANNER_BIN_RESOLVED" ]] || {
      cleanup_all "$loader" || true
      fail "planner binary is missing or not executable: $PLANNER_BIN_RESOLVED"
    }
    [[ "${PLANNER_BIN_RESOLVED##*/}" == "plasma-auto-tiler" ]] || {
      cleanup_all "$loader" || true
      fail "planner must be the plasma-auto-tiler binary: $PLANNER_BIN_RESOLVED"
    }
  fi
  local PLANNER_CANON_REQ=""
  PLANNER_CANON_REQ="$(canonical_path "$PLANNER_BIN_RESOLVED")" || {
    cleanup_all "$loader" || true
    fail "could not canonicalize the planner executable identity"
  }
  "$PLANNER_BIN_RESOLVED" planner-service >>"$RUNDIR/planner.log" 2>>"$RUNDIR/planner.stderr" &
  PLANNER_PID="$!"
  "$SLEEP_BIN" "$SHADOW_DELAY" >/dev/null 2>&1 || true
  local _planner_rc=0 _planner_err=""
  "$KILL_BIN" -0 -- "$PLANNER_PID" 2>/dev/null || {
    wait "$PLANNER_PID" 2>/dev/null || _planner_rc=$?
    if [[ -f "$RUNDIR/planner.stderr" ]]; then
      _planner_err="$(tail -c "$SHADOW_DIAG_MAX_BYTES" -- "$RUNDIR/planner.stderr" 2>/dev/null)" || _planner_err=""
    fi
    shadow_emit_diag "planner-launch" "${_planner_rc:-1}" "$NONCE" "$_planner_err"
    PLANNER_PID=""
    cleanup_all "$loader" || true
    fail "planner child exited immediately; no restart"
  }
  PLANNER_TICK="$(proc_start_tick "$PLANNER_PID")" || {
    exact_planner_stop >/dev/null 2>&1 || true
    PLANNER_PID=""
    cleanup_all "$loader" || true
    fail "could not pin the planner start tick; no restart"
  }
  PLANNER_EXE="$(proc_exe "$PLANNER_PID")" || {
    exact_planner_stop >/dev/null 2>&1 || true
    PLANNER_PID=""
    cleanup_all "$loader" || true
    fail "could not pin the planner executable identity; no restart"
  }
  PLANNER_CANON="$(canonical_path "$PLANNER_EXE")" || {
    exact_planner_stop >/dev/null 2>&1 || true
    PLANNER_PID=""
    cleanup_all "$loader" || true
    fail "planner live executable does not canonicalize; no restart"
  }
  [[ "$PLANNER_CANON" == "$PLANNER_CANON_REQ" ]] || {
    exact_planner_stop >/dev/null 2>&1 || true
    PLANNER_PID=""
    cleanup_all "$loader" || true
    fail "planner canonical mismatch (replacement suspected); no restart"
  }
  local PLANNER_PIN_RES=""
  PLANNER_PIN_RES="$(resolve_service_owner_pid "$PLANNER_SERVICE")" || {
    exact_planner_stop >/dev/null 2>&1 || true
    PLANNER_PID=""
    cleanup_all "$loader" || true
    fail "planner owner/PID resolution failed"
  }
  PLANNER_OWNER="${PLANNER_PIN_RES%% *}"
  local PLANNER_BUS_PID="${PLANNER_PIN_RES##* }"
  [[ "$PLANNER_OWNER" =~ ^:[0-9]+\.[0-9]+$ ]] || {
    exact_planner_stop >/dev/null 2>&1 || true
    PLANNER_PID=""
    cleanup_all "$loader" || true
    fail "planner owner is not a unique name"
  }
  [[ "$PLANNER_BUS_PID" == "$PLANNER_PID" ]] || {
    exact_planner_stop >/dev/null 2>&1 || true
    PLANNER_PID=""
    cleanup_all "$loader" || true
    fail "planner owner PID replacement detected; no restart"
  }
  test_hook "after-pin" || {
    cleanup_all "$loader" || true
    exit 1
  }
  # Re-resolve after the hook point: any owner/PID/tick/exe drift fails.
  local PLANNER_RE=""
  PLANNER_RE="$(resolve_service_owner_pid "$PLANNER_SERVICE")" || {
    cleanup_all "$loader" || true
    fail "planner owner re-resolution failed"
  }
  [[ "${PLANNER_RE%% *}" == "$PLANNER_OWNER" && "${PLANNER_RE##* }" == "$PLANNER_PID" ]] || {
    cleanup_all "$loader" || true
    fail "planner unique owner drift detected (collision or replacement)"
  }
  local PLANNER_TICK_RE=""
  PLANNER_TICK_RE="$(proc_start_tick "$PLANNER_PID")" || {
    cleanup_all "$loader" || true
    fail "planner PID is stale on recheck (PID reuse suspected)"
  }
  [[ "$PLANNER_TICK_RE" == "$PLANNER_TICK" ]] || {
    cleanup_all "$loader" || true
    fail "planner PID/start-tick drift detected (PID reuse suspected)"
  }
  local PLANNER_EXE_RE=""
  PLANNER_EXE_RE="$(proc_exe "$PLANNER_PID")" || {
    cleanup_all "$loader" || true
    fail "planner executable identity is unreadable on recheck"
  }
  [[ "$(canonical_path "$PLANNER_EXE_RE")" == "$PLANNER_CANON" ]] || {
    cleanup_all "$loader" || true
    fail "planner executable drift detected (replacement suspected)"
  }

  # Shadow transport while the Planner child is alive: the shared loader
  # parses the signed Script ID (0 valid when returned), introspects and runs
  # only the exact Script object, and requires the correlated bounded
  # source/ready/result/after where match|divergence pairs only with after
  # true. Any other detail fails closed with exact cleanup and no receipt.
  local S_OUT="" S_RC=0
  S_OUT="$(loader_start "$loader" --bundle "$S_BUNDLE" --manifest "$S_MANIFEST" --receipt "$SHADOW_RECEIPT" --diag-file "$S_DIAG" --input "$S_INPUT" --attempts "$SHADOW_ATTEMPTS" --delay "$SHADOW_DELAY" --expected-planner-owner "$PLANNER_OWNER" 2>&1)" || {
    S_RC=$?
    shadow_emit_diag "loader-start:shadow" "$S_RC" "$NONCE" "$S_OUT"
    if [[ "$S_OUT" == *"ambiguous"* && "$S_OUT" == *"preserving residue"* ]]; then
      printf 'error: loader reported ambiguous identity; preserving exact residue %s\n' "$RUNDIR" >&2
      PRESERVE_RESIDUE="1"
    fi
    cleanup_all "$loader" || true
    fail "shadow transport failed"
  }
  shadow_emit_diag "loader-start:shadow" "0" "$NONCE" "$S_OUT"
  [[ "$S_OUT" == *"correlation=$NONCE"* ]] || {
    cleanup_all "$loader" || true
    fail "shadow receipt bound the wrong correlation"
  }
  [[ -f "$SHADOW_RECEIPT" && ! -L "$SHADOW_RECEIPT" ]] || {
    cleanup_all "$loader" || true
    fail "shadow receipt is absent after the shadow transport"
  }
  local _s_diag_raw="" _s_diag_rc=0
  _s_diag_raw="$("$loader" diagnostics --receipt "$SHADOW_RECEIPT" --diag-file "$S_DIAG" 2>&1)" || _s_diag_rc=$?
  shadow_emit_diag "loader-diagnostics:shadow" "$_s_diag_rc" "$NONCE" "$_s_diag_raw"
  if [[ "$_s_diag_rc" -ne 0 ]]; then
    cleanup_all "$loader" || true
    fail "shadow diagnostics failed"
  fi
  local _s_stop_raw="" _s_stop_rc=0
  _s_stop_raw="$("$loader" stop --receipt "$SHADOW_RECEIPT" 2>&1)" || _s_stop_rc=$?
  shadow_emit_diag "loader-stop:shadow" "$_s_stop_rc" "$NONCE" "$_s_stop_raw"
  if [[ "$_s_stop_rc" -ne 0 ]]; then
    cleanup_all "$loader" || true
    fail "shadow exact cleanup failed"
  fi
  [[ ! -e "$SHADOW_RECEIPT" && ! -L "$SHADOW_RECEIPT" ]] || {
    cleanup_all "$loader" || true
    fail "shadow receipt survived exact cleanup"
  }

  # Exact Planner stop and unique-owner loss proof for its Planner before the
  # known namespace is removed.
  exact_planner_stop || {
    shadow_emit_diag "planner-stop:shadow" "1" "$NONCE" "$(shadow_file_tail "$RUNDIR/planner.stderr")"
    cleanup_all "$loader" || true
    exit 1
  }
  prove_planner_owner_loss || {
    shadow_emit_diag "owner-loss" "1" "$NONCE" "$(shadow_file_tail "$RUNDIR/planner.stderr")"
    cleanup_all "$loader" || true
    exit 1
  }

  # Post-phase KWin continuity through the shared loader preflight.
  local KWIN_RE=""
  KWIN_RE="$(resolve_service_owner_pid "$KWIN_SERVICE")" || {
    cleanup_all "$loader" || true
    fail "post-phase KWin resolution failed"
  }
  [[ "${KWIN_RE%% *}" == "$KWIN_OWNER" && "${KWIN_RE##* }" == "$KWIN_PID" ]] || {
    cleanup_all "$loader" || true
    fail "post-phase KWin owner/PID drift detected"
  }
  [[ "$(proc_start_tick "$KWIN_PID")" == "$KWIN_TICK" ]] || {
    cleanup_all "$loader" || true
    fail "post-phase KWin start-tick drift detected"
  }
  local PREFLIGHT_AFTER=""
  PREFLIGHT_AFTER="$(loader_preflight "$loader" "$S_BUNDLE" "$S_MANIFEST" "$S_INPUT")" || {
    cleanup_all "$loader" || true
    fail "post-phase loader preflight failed for shadow"
  }
  [[ -n "$PREFLIGHT_AFTER" ]] || {
    cleanup_all "$loader" || true
    fail "post-phase loader preflight emitted no identity for shadow"
  }

  cleanup_all "$loader" || exit 1
  printf 'shadow-lifecycle: phases=shadow continuity=verified correlation=%s\n' "$NONCE"
}

case "${1:-}" in
  run)
    shift
    cmd_run "$@"
    ;;
  --help|-h|help)
    [[ $# -eq 1 ]] || fail "'--help' takes no arguments"
    usage
    ;;
  *)
    printf 'error: unknown command (expected run)\n' >&2
    exit 1
    ;;
esac
