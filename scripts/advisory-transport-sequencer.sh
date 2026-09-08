#!/usr/bin/env bash
# Authorized fail-closed test-only host transport sequencer (disabled by default).
#
# Single authorized journey only: `run` drives success, stale, then loss
# advisory transports through the exact current loader
# (scripts/advisory-describe-host.sh: preflight, present-owner start, explicit
# refusal mode) plus one `planner-service --advisory-loss-correlation` child.
# Static checks and fake-command tests cover the contract; live use needs
# ADVISORY_TRANSPORT_ALLOW=1 and the exact repo resources below.
#
# Order (strict, no duplicates, event-driven bounded waits):
#   1. bootstrap the success record, build the exact bundle, run the loader
#      resource-free preflight. The fresh namespaced runtime dir is created
#      only after that preflight passes.
#   2. generate three valid records/bundles with distinct nonce/correlation
#      and one owner/generation/revision: success, stale, loss-armed.
#   3. launch exactly one Planner child with the loss correlation armed, pin
#      PID/start-tick/exe identity, resolve and pin the unique D-Bus
#      owner/PID, reject collision/replacement. No restart.
#   4. success via loader start (receipt), stale via explicit refusal
#      (reject:advisory-rejected-stale-request/true, exact cleanup), loss via
#      a PID-filtered journal follower plus the exact Planner stderr JSON
#      service-loss-ready marker, then exact Planner stop and owner-loss proof
#      before accepting reject:advisory-timeout/true.
#   5. post-phase KWin/production continuity via loader preflight checks.
# Cleanup covers every partial phase through known IDs only (loader
# receipts, exact Planner identity, follower, current fresh dir, generated
# artifacts). Identity/cleanup ambiguity preserves the exact residue and
# fails. Prior advisory residue is never scanned or touched, and no machine
# data is retained in the repository.
#
# usage: advisory-transport-sequencer.sh <run|--help>
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
: "${ADVISORY_TRANSPORT_ALLOW:=0}"
: "${ADVISORY_TRANSPORT_TEST_FAKE:=0}"
: "${SEQUENCER_LOADER:=$REPO_ROOT/scripts/advisory-describe-host.sh}"
: "${SEQUENCER_BUILDER:=$REPO_ROOT/scripts/advisory-describe-build.mjs}"
: "${SEQUENCER_DIST_DIR:=$REPO_ROOT/kwin/dist}"
: "${PLANNER_BIN:=}"
: "${BUSCTL_BIN:=busctl}"
: "${JOURNALCTL_BIN:=journalctl}"
: "${NODE_BIN:=node}"
: "${SHA256SUM_BIN:=sha256sum}"
: "${KILL_BIN:=kill}"
: "${SLEEP_BIN:=sleep}"
: "${READLINK_BIN:=readlink}"
: "${STAT_BIN:=stat}"
: "${PROC_ROOT:=/proc}"
: "${SEQUENCER_ATTEMPTS:=50}"
: "${SEQUENCER_DELAY:=0.1}"
: "${SEQUENCER_MARKER_ATTEMPTS:=100}"
: "${SEQUENCER_MARKER_DELAY:=0.1}"
: "${SEQUENCER_STOP_ATTEMPTS:=50}"
: "${SEQUENCER_TEST_HOOK_AFTER_PIN:=}"
: "${SEQUENCER_TEST_HOOK_BEFORE_STOP:=}"

EXACT_LOADER="$REPO_ROOT/scripts/advisory-describe-host.sh"
EXACT_BUILDER="$REPO_ROOT/scripts/advisory-describe-build.mjs"
EXACT_DIST_DIR="$REPO_ROOT/kwin/dist"
STALE_DETAIL="reject:advisory-rejected-stale-request"
TIMEOUT_DETAIL="reject:advisory-timeout"
SEQ_OWNER="adv-transport-owner"
SEQ_GENERATION="adv-transport-gen"
SEQ_REVISION="7"
PLANNER_SERVICE="org.plasmaautotiler.Planner"
KWIN_SERVICE="org.kde.KWin"
LOSS_KIND="planner-service-loss-ready"

RUNDIR=""
RUNDIR_PARENT=""
BUILT_DIST="0"
PLANNER_PID=""
PLANNER_TICK=""
PLANNER_EXE=""
PLANNER_CANON=""
PLANNER_OWNER=""
FOLLOWER_PID=""
PRESERVE_RESIDUE="0"
PHASE_DONE=""

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'EOF'
usage: advisory-transport-sequencer.sh <run|--help>

Authorized fail-closed test-only host transport sequencer. Disabled unless
ADVISORY_TRANSPORT_ALLOW=1. One journey only: run drives success, stale,
then loss transports through the exact loader plus one armed Planner child
under one fresh namespaced runtime dir. No other command exists.
EOF
}

require_allow() {
  [[ "${ADVISORY_TRANSPORT_ALLOW:-0}" == "1" ]] || {
    printf 'error: advisory transport sequencer is disabled by default (set ADVISORY_TRANSPORT_ALLOW=1 for the authorized test-only pass)\n' >&2
    exit 1
  }
}

test_fake_gate() {
  [[ "${ADVISORY_TRANSPORT_TEST_FAKE:-0}" == "1" ]]
}

safe_abs() {
  local path="$1"
  [[ "$path" == /* && "$path" != *'//' && "$path" != *'/../'* \
    && "$path" != */.. && "$path" != */./* && "$path" != */. ]] || return 1
  [[ "$path" != "/" ]] || return 1
}

# Production pins the exact repo loader/builder/dist; any override is an
# explicit test-only fake and requires the fake gate.
resolve_pinned_path() {
  local value="$1" exact="$2" label="$3"
  if [[ "$value" == "$exact" ]]; then
    printf '%s' "$value"
    return 0
  fi
  test_fake_gate || {
    printf 'error: %s override is test-only (requires ADVISORY_TRANSPORT_TEST_FAKE=1): %s\n' "$label" "$value" >&2
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
      printf 'error: PROC_ROOT must be /proc in production (synthetic roots require ADVISORY_TRANSPORT_TEST_FAKE=1)\n' >&2
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

# Real-/proc liveness for background jobs (loss loader, follower): live
# requires kill -0 plus a readable non-zombie state. Uses the real /proc
# because these PIDs are real children, never fixtures under PROC_ROOT.
real_proc_start_tick() {
  local pid="$1" stat_line="" stat_pid="" rest=""
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  stat_line="$(<"/proc/$pid/stat")" || return 1
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

real_proc_alive_non_zombie() {
  local pid="$1"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  "$KILL_BIN" -0 -- "$pid" 2>/dev/null || return 1
  [[ -n "$(real_proc_start_tick "$pid" 2>/dev/null)" ]] || return 1
  return 0
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
  if [[ "$point" == "after-pin" ]]; then hook="$SEQUENCER_TEST_HOOK_AFTER_PIN";
  elif [[ "$point" == "before-stop" ]]; then hook="$SEQUENCER_TEST_HOOK_BEFORE_STOP";
  else return 0; fi
  [[ -n "$hook" ]] || return 0
  test_fake_gate || {
    printf 'error: sequencer test hook is test-only (requires ADVISORY_TRANSPORT_TEST_FAKE=1)\n' >&2
    return 1
  }
  [[ -f "$hook" && ! -L "$hook" ]] || {
    printf 'error: sequencer test hook is unavailable: %s\n' "$hook" >&2
    return 1
  }
  bash -- "$hook" "$point" || {
    printf 'error: sequencer test hook failed at %s\n' "$point" >&2
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

bus_unique_name_absent() {
  BUS_JSON="$1" BUS_OWNER="$2" "$NODE_BIN" -e '
const raw = process.env.BUS_JSON || "";
let v;
try { v = JSON.parse(raw); } catch (e) { process.exit(1); }
if (typeof v !== "object" || v === null || Array.isArray(v)) process.exit(1);
if (v.type !== "as" || !Array.isArray(v.data) || v.data.length !== 1 || !Array.isArray(v.data[0])) process.exit(1);
const names = v.data[0];
if (names.some((name) => typeof name !== "string")) process.exit(1);
if (names.includes(process.env.BUS_OWNER)) process.exit(1);
' 2>/dev/null
}

planner_absent_check() {
  local out="" has=""
  out="$("$BUSCTL_BIN" --user --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus NameHasOwner s "$PLANNER_SERVICE" 2>/dev/null)" || {
    printf 'error: planner absence check failed (transport failure)\n' >&2
    return 1
  }
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
  local out=""
  out="$("$BUSCTL_BIN" --user --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s "$service" 2>/dev/null)" || {
    printf 'error: GetNameOwner failed for %s\n' "$service" >&2
    return 1
  }
  owner="$(bus_unique_name "$out")" || {
    printf 'error: malformed GetNameOwner reply for %s\n' "$service" >&2
    return 1
  }
  out="$("$BUSCTL_BIN" --user --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetConnectionUnixProcessID s "$owner" 2>/dev/null)" || {
    printf 'error: could not resolve the Unix PID for %s owner %s\n' "$service" "$owner" >&2
    return 1
  }
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
  snapshot: {
    outputs: [{ id: "source", workspace: "workspace-1", tree: { kind: "group", id: "root", axis: "horizontal", children: [{ kind: "group", id: "left", axis: "vertical", children: [{ kind: "leaf", id: "A" }, { kind: "leaf", id: "B" }] }, { kind: "leaf", id: "C" }] }, adjacent: {} }],
    windows: [
      { window: "w-A", leaf: "A", output: "source", workspace: "workspace-1" },
      { window: "w-B", leaf: "B", output: "source", workspace: "workspace-1" },
      { window: "w-C", leaf: "C", output: "source", workspace: "workspace-1" }
    ]
  },
  intent: { source_output: "source", focused_leaf: "A", focused_window: "w-A", direction: "down" },
  capabilities: { swap_neighbor: true, wrap_perpendicular: true, wrap_siblings: true, insert_child: true, split_group_child: true, reparent_leaf: true, cross_output_transfer: true }
};
fs.writeFileSync(process.env.REQ_FILE, JSON.stringify(record));
' || {
    printf 'error: could not write the request record: %s\n' "$file" >&2
    return 1
  }
}

# Build one phase bundle through the exact builder into the dist dir, then
# stage the exact outputs under the fresh runtime dir. Refuses to overwrite
# prior dist residue.
build_one() {
  local loader="$1" builder="$2" dist="$3" name="$4" nonce="$5"
  local input="$RUNDIR/$name/request.json"
  local bundle="$RUNDIR/$name/advisory-describe.js"
  local manifest="$RUNDIR/$name/advisory-describe.manifest.json"
  mkdir -p -- "$RUNDIR/$name" || {
    printf 'error: could not stage phase dir: %s\n' "$name" >&2
    return 1
  }
  write_request_json "$input" "$nonce" || return 1
  "$NODE_BIN" -- "$builder" --input "$input" --out "$dist/advisory-describe.js" >/dev/null 2>&1 || {
    printf 'error: builder failed for phase %s\n' "$name" >&2
    return 1
  }
  BUILT_DIST="1"
  cp -p -- "$dist/advisory-describe.js" "$bundle" || {
    printf 'error: could not stage the bundle for phase %s\n' "$name" >&2
    return 1
  }
  cp -p -- "$dist/advisory-describe.manifest.json" "$manifest" || {
    printf 'error: could not stage the manifest for phase %s\n' "$name" >&2
    return 1
  }
  # Fail closed when the staged manifest does not bind this exact nonce.
  grep -Fq -- "\"correlationId\":\"$nonce\"" "$manifest" || {
    printf 'error: staged manifest does not bind phase %s correlation\n' "$name" >&2
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
  while [[ "$attempt" -lt "$SEQUENCER_STOP_ATTEMPTS" ]]; do
    if ! "$KILL_BIN" -0 -- "$PLANNER_PID" 2>/dev/null; then
      PLANNER_PID=""
      return 0
    fi
    "$SLEEP_BIN" "$SEQUENCER_DELAY" >/dev/null 2>&1 || return 1
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
  local out="" has=""
  out="$("$BUSCTL_BIN" --user --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus NameHasOwner s "$PLANNER_SERVICE" 2>/dev/null)" || {
    printf 'error: planner owner-loss check failed (transport failure)\n' >&2
    return 1
  }
  has="$(bus_bool "$out")" || {
    printf 'error: malformed NameHasOwner reply for %s\n' "$PLANNER_SERVICE" >&2
    return 1
  }
  [[ "$has" == "false" ]] || {
    printf 'error: planner service %s is still owned; refusing timeout acceptance\n' "$PLANNER_SERVICE" >&2
    return 1
  }
  # NameHasOwner proves well-known-name loss. ListNames is the authoritative
  # structured bus reply for the pinned unique-owner absence, avoiding an
  # ambiguous failed GetConnectionUnixProcessID transport call.
  local names_out=""
  names_out="$("$BUSCTL_BIN" --user --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus ListNames 2>/dev/null)" || {
    printf 'error: planner unique-owner loss check failed (transport failure)\n' >&2
    return 1
  }
  bus_unique_name_absent "$names_out" "$PLANNER_OWNER" || {
    printf 'error: pinned planner owner %s is still present or ListNames is malformed\n' "$PLANNER_OWNER" >&2
    return 1
  }
  return 0
}

stop_follower() {
  [[ -n "$FOLLOWER_PID" ]] || return 0
  local pid="$FOLLOWER_PID"
  FOLLOWER_PID=""
  if real_proc_alive_non_zombie "$pid" 2>/dev/null; then
    "$KILL_BIN" -TERM -- "$pid" 2>/dev/null || true
    local attempt=0
    while [[ "$attempt" -lt "$SEQUENCER_STOP_ATTEMPTS" ]]; do
      real_proc_alive_non_zombie "$pid" 2>/dev/null || break
      "$SLEEP_BIN" "$SEQUENCER_DELAY" >/dev/null 2>&1 || break
      attempt=$((attempt + 1))
    done
  fi
  wait "$pid" 2>/dev/null || true
  return 0
}

start_follower() {
  local diag="$1" kwin_pid="$2"
  local cursor_out="" cursor=""
  cursor_out="$("$JOURNALCTL_BIN" --user --show-cursor 2>/dev/null)" || {
    printf 'error: journal cursor capture failed\n' >&2
    return 1
  }
  cursor="$(printf '%s' "$cursor_out" | grep -F -- '-- cursor: ' | tail -n 1 | sed -n 's/.*-- cursor: //p')" || {
    printf 'error: journal cursor is unreadable\n' >&2
    return 1
  }
  [[ -n "$cursor" ]] || {
    printf 'error: journal cursor is empty\n' >&2
    return 1
  }
  "$JOURNALCTL_BIN" --user -o cat --after-cursor "$cursor" "_PID=$kwin_pid" -f >>"$diag" 2>/dev/null &
  FOLLOWER_PID="$!"
  "$SLEEP_BIN" "$SEQUENCER_DELAY" >/dev/null 2>&1 || true
  real_proc_alive_non_zombie "$FOLLOWER_PID" 2>/dev/null || {
    printf 'error: journal follower exited immediately\n' >&2
    FOLLOWER_PID=""
    return 1
  }
}

# Bounded wait for the exact correlation-bound KWin ready marker in the
# PID-filtered follower diagnostic. Requires exactly one exact line
# plasma-auto-tiler:advisory-describe-ready:<correlation>; any other ready
# line (malformed/stale) or a duplicate exact line fails closed. Missing
# waits boundedly, then fails. Must precede the Planner stderr loss-ready
# marker acceptance so loss never proceeds without KWin evidence.
wait_kwin_ready_marker() {
  local file="$1" correlation="$2"
  local attempt=0
  while [[ "$attempt" -lt "$SEQUENCER_MARKER_ATTEMPTS" ]]; do
    if [[ -f "$file" ]]; then
      if READY_FILE="$file" READY_CORR="$correlation" \
        "$NODE_BIN" -e '
const fs = require("node:fs");
const file = process.env.READY_FILE;
const corr = process.env.READY_CORR;
let text;
try { text = fs.readFileSync(file, "utf8"); } catch (e) { process.exit(2); }
const expected = "plasma-auto-tiler:advisory-describe-ready:" + corr;
const lines = text.split("\n");
let exact = 0;
let suspicious = 0;
for (const line of lines) {
  if (!line) continue;
  if (!line.includes("advisory-describe-ready")) continue;
  suspicious += 1;
  if (line === expected) {
    exact += 1;
  } else {
    console.error("malformed or stale KWin ready marker");
    process.exit(1);
  }
}
if (exact === 1 && suspicious === 1) process.exit(0);
if (exact > 1) { console.error("duplicate KWin ready marker"); process.exit(1); }
process.exit(2);
' 2>"$RUNDIR/kwin-ready-err.log"; then
        return 0
      else
        local rc=$?
        if [[ "$rc" -eq 1 ]]; then
          printf 'error: KWin ready marker failed validation\n' >&2
          return 1
        fi
      fi
    fi
    "$SLEEP_BIN" "$SEQUENCER_MARKER_DELAY" >/dev/null 2>&1 || return 1
    attempt=$((attempt + 1))
  done
  printf 'error: KWin ready marker not observed (bounded wait)\n' >&2
  return 1
}

# Bounded wait for the exact Planner stderr JSON service-loss-ready marker
# binding v1/correlation/owner/generation/revision. Malformed, duplicate, or
# stale marker lines fail closed.
wait_loss_marker() {
  local file="$1" correlation="$2"
  local attempt=0
  while [[ "$attempt" -lt "$SEQUENCER_MARKER_ATTEMPTS" ]]; do
    if [[ -f "$file" ]]; then
      if LOSS_FILE="$file" LOSS_CORR="$correlation" LOSS_OWNER="$SEQ_OWNER" LOSS_GEN="$SEQ_GENERATION" LOSS_REV="$SEQ_REVISION" \
        "$NODE_BIN" -e '
const fs = require("node:fs");
const file = process.env.LOSS_FILE;
let text;
try { text = fs.readFileSync(file, "utf8"); } catch (e) { process.exit(2); }
const lines = text.split("\n");
let exact = 0;
const wantRev = Number(process.env.LOSS_REV);
if (!Number.isInteger(wantRev) || wantRev < 0 || wantRev > 1000000) { console.error("malformed expected revision"); process.exit(1); }
for (const line of lines) {
  if (!line) continue;
  if (!line.includes("planner-service-loss-ready") && !line.includes(process.env.LOSS_CORR)) continue;
  if (Buffer.byteLength(line, "utf8") > 1024) { console.error("oversize loss marker line"); process.exit(1); }
  let v;
  try { v = JSON.parse(line); } catch (e) { console.error("malformed loss marker line"); process.exit(1); }
  if (typeof v !== "object" || v === null || Array.isArray(v)) { console.error("malformed loss marker shape"); process.exit(1); }
  const keys = Object.keys(v).sort();
  const want = ["correlation_id", "generation", "marker", "owner", "revision", "v"].sort();
  if (keys.length !== want.length || keys.some((k, i) => k !== want[i])) { console.error("malformed loss marker keys"); process.exit(1); }
  if (v.v !== 1 || !Number.isInteger(v.v) || v.marker !== "planner-service-loss-ready") { console.error("malformed loss marker version"); process.exit(1); }
  if (typeof v.correlation_id !== "string" || typeof v.owner !== "string" || typeof v.generation !== "string") { console.error("malformed loss marker binding types"); process.exit(1); }
  if (!Number.isInteger(v.revision) || v.revision < 0 || v.revision > 1000000) { console.error("malformed loss marker revision"); process.exit(1); }
  if (v.correlation_id !== process.env.LOSS_CORR || v.owner !== process.env.LOSS_OWNER || v.generation !== process.env.LOSS_GEN || v.revision !== wantRev) {
    console.error("stale or mismatched loss marker binding"); process.exit(1);
  }
  exact += 1;
}
if (exact === 1) process.exit(0);
if (exact > 1) { console.error("duplicate loss marker"); process.exit(1); }
process.exit(2);
' 2>"$RUNDIR/marker-err.log"; then
        return 0
      else
        local rc=$?
        if [[ "$rc" -eq 1 ]]; then
          printf 'error: planner loss marker failed validation\n' >&2
          return 1
        fi
      fi
    fi
    "$SLEEP_BIN" "$SEQUENCER_MARKER_DELAY" >/dev/null 2>&1 || return 1
    attempt=$((attempt + 1))
  done
  printf 'error: planner loss marker not observed (bounded wait)\n' >&2
  return 1
}

cleanup_generated() {
  if [[ "$BUILT_DIST" == "1" ]]; then
    rm -f -- "$SEQUENCER_DIST_DIR/advisory-describe.js" "$SEQUENCER_DIST_DIR/advisory-describe.manifest.json" 2>/dev/null || true
  fi
}

cleanup_all() {
  local loader="$1"
  stop_follower || true
  local receipt=""
  for receipt in "${SUCCESS_RECEIPT:-}" "$RUNDIR/success/receipt.json" "$RUNDIR/stale/receipt.json" "$RUNDIR/loss/receipt.json"; do
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
  command -v "$JOURNALCTL_BIN" >/dev/null 2>&1 || fail "required tool '$JOURNALCTL_BIN' not found in PATH"
  local loader="" builder="" dist=""
  loader="$(resolve_pinned_path "$SEQUENCER_LOADER" "$EXACT_LOADER" "loader")" || exit 1
  builder="$(resolve_pinned_path "$SEQUENCER_BUILDER" "$EXACT_BUILDER" "builder")" || exit 1
  dist="$(resolve_pinned_path "$SEQUENCER_DIST_DIR" "$EXACT_DIST_DIR" "dist dir")" || exit 1
  [[ -f "$loader" && ! -L "$loader" ]] || fail "loader is unavailable: $loader"
  [[ -d "$dist" && ! -L "$dist" ]] || fail "dist dir is unavailable: $dist"
  [[ "$SEQUENCER_ATTEMPTS" =~ ^(0|[1-9][0-9]*)$ && "$SEQUENCER_ATTEMPTS" -ge 1 && "$SEQUENCER_ATTEMPTS" -le 500 ]] || fail "invalid SEQUENCER_ATTEMPTS (1..500)"
  [[ "$SEQUENCER_MARKER_ATTEMPTS" =~ ^(0|[1-9][0-9]*)$ && "$SEQUENCER_MARKER_ATTEMPTS" -ge 1 ]] || fail "invalid SEQUENCER_MARKER_ATTEMPTS"
  if [[ -e "$dist/advisory-describe.js" || -L "$dist/advisory-describe.js" || -e "$dist/advisory-describe.manifest.json" || -L "$dist/advisory-describe.manifest.json" ]]; then
    fail "prior advisory dist residue is present; refusing to overwrite or scan it"
  fi
  # Distinct bootstrap nonces for the three phases, one shared binding.
  local NONCE_SUCCESS="" NONCE_STALE="" NONCE_LOSS=""
  NONCE_SUCCESS="$(nonce_new success)" || fail "could not generate the success correlation"
  NONCE_STALE="$(nonce_new stale)" || fail "could not generate the stale correlation"
  NONCE_LOSS="$(nonce_new loss)" || fail "could not generate the loss correlation"
  [[ "$NONCE_SUCCESS" != "$NONCE_STALE" && "$NONCE_SUCCESS" != "$NONCE_LOSS" && "$NONCE_STALE" != "$NONCE_LOSS" ]] || fail "phase correlations must be distinct"

  # Bootstrap: stage the success input outside the fresh dir, build the exact
  # bundle, and pass the loader resource-free preflight before any runtime
  # dir exists.
  local BOOTSTRAP_INPUT=""
  BOOTSTRAP_INPUT="$(mktemp "${TMPDIR:-/tmp}/advisory-transport-bootstrap-XXXXXX.json")" || fail "could not stage the bootstrap input"
  write_request_json "$BOOTSTRAP_INPUT" "$NONCE_SUCCESS" || {
    rm -f -- "$BOOTSTRAP_INPUT"
    exit 1
  }
  "$NODE_BIN" -- "$builder" --input "$BOOTSTRAP_INPUT" --out "$dist/advisory-describe.js" >/dev/null 2>&1 || {
    rm -f -- "$BOOTSTRAP_INPUT"
    cleanup_generated
    fail "bootstrap builder failed"
  }
  BUILT_DIST="1"
  local PREFLIGHT_BEFORE=""
  PREFLIGHT_BEFORE="$(loader_preflight "$loader" "$dist/advisory-describe.js" "$dist/advisory-describe.manifest.json" "$BOOTSTRAP_INPUT")" || {
    rm -f -- "$BOOTSTRAP_INPUT"
    cleanup_generated
    fail "bootstrap loader preflight failed"
  }
  [[ -n "$PREFLIGHT_BEFORE" ]] || {
    cleanup_generated
    fail "bootstrap loader preflight emitted no identity"
  }
  rm -f -- "$BOOTSTRAP_INPUT"

  # One fresh namespaced runtime dir, only after the preflight above passed.
  RUNDIR_PARENT="${TMPDIR:-/tmp}"
  RUNDIR="$(mktemp -d "$RUNDIR_PARENT/advisory-transport-XXXXXX")" || {
    cleanup_generated
    fail "could not create the fresh runtime dir"
  }
  chmod 700 -- "$RUNDIR" || {
    cleanup_generated
    fail "could not lock the fresh runtime dir"
  }
  local RUNDIR_MODE=""
  RUNDIR_MODE="$("$STAT_BIN" -c '%a' -- "$RUNDIR" 2>/dev/null)" || {
    cleanup_generated
    fail "could not stat the fresh runtime dir"
  }
  [[ "$RUNDIR_MODE" == "700" ]] || {
    cleanup_generated
    fail "fresh runtime dir mode is $RUNDIR_MODE, expected 700"
  }
  local SUCCESS_RECEIPT="$RUNDIR/success/receipt.json"

  # Pin the current KWin identity for the follower filter and continuity.
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

  # Three valid records/bundles under the fresh dir only.
  build_one "$loader" "$builder" "$dist" "success" "$NONCE_SUCCESS" || {
    cleanup_all "$loader" || true
    fail "success bundle build failed"
  }
  build_one "$loader" "$builder" "$dist" "stale" "$NONCE_STALE" || {
    cleanup_all "$loader" || true
    fail "stale bundle build failed"
  }
  build_one "$loader" "$builder" "$dist" "loss" "$NONCE_LOSS" || {
    cleanup_all "$loader" || true
    fail "loss bundle build failed"
  }

  # One Planner child only, armed with the loss correlation. Collision fails.
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
  "$PLANNER_BIN_RESOLVED" planner-service --advisory-loss-correlation "$NONCE_LOSS" >>"$RUNDIR/planner.log" 2>>"$RUNDIR/planner.stderr" &
  PLANNER_PID="$!"
  "$SLEEP_BIN" "$SEQUENCER_DELAY" >/dev/null 2>&1 || true
  "$KILL_BIN" -0 -- "$PLANNER_PID" 2>/dev/null || {
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
  local PLANNER_PIN=""
  PLANNER_PIN="$(resolve_service_owner_pid "$PLANNER_SERVICE")" || {
    exact_planner_stop >/dev/null 2>&1 || true
    PLANNER_PID=""
    cleanup_all "$loader" || true
    fail "planner owner/PID resolution failed"
  }
  PLANNER_OWNER="${PLANNER_PIN%% *}"
  local PLANNER_BUS_PID="${PLANNER_PIN##* }"
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

  # Phase 1: success receipt while the Planner child is alive.
  PHASE_DONE=""
  local S_BUNDLE="$RUNDIR/success/advisory-describe.js" S_MANIFEST="$RUNDIR/success/advisory-describe.manifest.json"
  local S_INPUT="$RUNDIR/success/request.json" S_DIAG="$RUNDIR/success/diag.log"
  : > "$S_DIAG" || {
    cleanup_all "$loader" || true
    fail "could not create the success diag file"
  }
  start_follower "$S_DIAG" "$KWIN_PID" || {
    cleanup_all "$loader" || true
    fail "success journal follower failed"
  }
  local S_OUT=""
  S_OUT="$(loader_start "$loader" --bundle "$S_BUNDLE" --manifest "$S_MANIFEST" --receipt "$SUCCESS_RECEIPT" --diag-file "$S_DIAG" --input "$S_INPUT" --attempts "$SEQUENCER_ATTEMPTS" --delay "$SEQUENCER_DELAY" --expected-planner-owner "$PLANNER_OWNER" 2>&1)" || {
    local S_RC=$?
    if [[ "$S_OUT" == *"ambiguous"* && "$S_OUT" == *"preserving residue"* ]]; then
      printf 'error: loader reported ambiguous identity; preserving exact residue %s\n' "$RUNDIR" >&2
      PRESERVE_RESIDUE="1"
    fi
    stop_follower
    cleanup_all "$loader" || true
    fail "success transport failed"
  }
  wait_kwin_ready_marker "$S_DIAG" "$NONCE_SUCCESS" || {
    stop_follower
    cleanup_all "$loader" || true
    fail "success KWin ready marker wait failed"
  }
  stop_follower
  [[ "$S_OUT" == *"correlation=$NONCE_SUCCESS"* ]] || {
    cleanup_all "$loader" || true
    fail "success receipt bound the wrong correlation"
  }
  [[ -f "$SUCCESS_RECEIPT" && ! -L "$SUCCESS_RECEIPT" ]] || {
    cleanup_all "$loader" || true
    fail "success receipt is absent after the success transport"
  }
  "$loader" diagnostics --receipt "$SUCCESS_RECEIPT" --diag-file "$S_DIAG" >/dev/null 2>&1 || {
    cleanup_all "$loader" || true
    fail "success diagnostics failed"
  }
  "$loader" stop --receipt "$SUCCESS_RECEIPT" >/dev/null 2>&1 || {
    cleanup_all "$loader" || true
    fail "success exact cleanup failed"
  }
  [[ ! -e "$SUCCESS_RECEIPT" && ! -L "$SUCCESS_RECEIPT" ]] || {
    cleanup_all "$loader" || true
    fail "success receipt survived exact cleanup"
  }
  PHASE_DONE="success"

  # Phase 2: stale explicit refusal, same binding shape, distinct correlation.
  [[ "$PHASE_DONE" == "success" ]] || {
    cleanup_all "$loader" || true
    fail "phase ordering violated: stale requires success first"
  }
  local T_BUNDLE="$RUNDIR/stale/advisory-describe.js" T_MANIFEST="$RUNDIR/stale/advisory-describe.manifest.json"
  local T_INPUT="$RUNDIR/stale/request.json" T_DIAG="$RUNDIR/stale/diag.log" T_RECEIPT="$RUNDIR/stale/receipt.json"
  : > "$T_DIAG" || {
    cleanup_all "$loader" || true
    fail "could not create the stale diag file"
  }
  start_follower "$T_DIAG" "$KWIN_PID" || {
    cleanup_all "$loader" || true
    fail "stale journal follower failed"
  }
  local T_OUT=""
  T_OUT="$(loader_start "$loader" --bundle "$T_BUNDLE" --manifest "$T_MANIFEST" --receipt "$T_RECEIPT" --diag-file "$T_DIAG" --input "$T_INPUT" --attempts "$SEQUENCER_ATTEMPTS" --delay "$SEQUENCER_DELAY" --expected-planner-owner "$PLANNER_OWNER" --expected-refusal-detail "$STALE_DETAIL" --expected-refusal-after true 2>&1)" || {
    if [[ "$T_OUT" == *"ambiguous"* && "$T_OUT" == *"preserving residue"* ]]; then
      printf 'error: loader reported ambiguous identity; preserving exact residue %s\n' "$RUNDIR" >&2
      PRESERVE_RESIDUE="1"
    fi
    stop_follower
    cleanup_all "$loader" || true
    fail "stale refusal transport failed"
  }
  wait_kwin_ready_marker "$T_DIAG" "$NONCE_STALE" || {
    stop_follower
    cleanup_all "$loader" || true
    fail "stale KWin ready marker wait failed"
  }
  stop_follower
  [[ "$T_OUT" == *"detail=$STALE_DETAIL"* && "$T_OUT" == *"after=true"* ]] || {
    cleanup_all "$loader" || true
    fail "stale refusal bound the wrong detail/after pair"
  }
  [[ ! -e "$T_RECEIPT" && ! -L "$T_RECEIPT" ]] || {
    cleanup_all "$loader" || true
    fail "stale refusal must leave no receipt"
  }
  PHASE_DONE="success,stale"

  # Phase 3: loss. The script starts while the Planner child is alive; wait
  # for the exact stderr loss marker, stop the exact verified Planner, prove
  # owner loss, then accept the timeout refusal.
  [[ "$PHASE_DONE" == "success,stale" ]] || {
    cleanup_all "$loader" || true
    fail "phase ordering violated: loss requires success then stale first"
  }
  local L_BUNDLE="$RUNDIR/loss/advisory-describe.js" L_MANIFEST="$RUNDIR/loss/advisory-describe.manifest.json"
  local L_INPUT="$RUNDIR/loss/request.json" L_DIAG="$RUNDIR/loss/diag.log" L_RECEIPT="$RUNDIR/loss/receipt.json"
  : > "$L_DIAG" || {
    cleanup_all "$loader" || true
    fail "could not create the loss diag file"
  }
  start_follower "$L_DIAG" "$KWIN_PID" || {
    cleanup_all "$loader" || true
    fail "loss journal follower failed"
  }
  local L_OUT_FILE="$RUNDIR/loss/loader-out.txt"
  loader_start "$loader" --bundle "$L_BUNDLE" --manifest "$L_MANIFEST" --receipt "$L_RECEIPT" --diag-file "$L_DIAG" --input "$L_INPUT" --attempts "$SEQUENCER_ATTEMPTS" --delay "$SEQUENCER_DELAY" --expected-planner-owner "$PLANNER_OWNER" --expected-refusal-detail "$TIMEOUT_DETAIL" --expected-refusal-after true --refusal-service-loss >"$L_OUT_FILE" 2>&1 &
  local LOSS_JOB="$!"
  local LOSS_TICK=""
  LOSS_TICK="$(real_proc_start_tick "$LOSS_JOB" 2>/dev/null)" || {
    kill -- "$LOSS_JOB" 2>/dev/null || true
    wait "$LOSS_JOB" 2>/dev/null || true
    stop_follower
    cleanup_all "$loader" || true
    fail "loss loader job failed to start with a pinned start-tick"
  }
  wait_kwin_ready_marker "$L_DIAG" "$NONCE_LOSS" || {
    if grep -qF 'ambiguous' "$L_OUT_FILE" 2>/dev/null && grep -qF 'preserving residue' "$L_OUT_FILE" 2>/dev/null; then
      printf 'error: loader reported ambiguous identity; preserving exact residue %s\n' "$RUNDIR" >&2
      PRESERVE_RESIDUE="1"
    fi
    kill -- "$LOSS_JOB" 2>/dev/null || true
    wait "$LOSS_JOB" 2>/dev/null || true
    stop_follower
    cleanup_all "$loader" || true
    fail "loss KWin ready marker wait failed"
  }
  wait_loss_marker "$RUNDIR/planner.stderr" "$NONCE_LOSS" || {
    if grep -qF 'ambiguous' "$L_OUT_FILE" 2>/dev/null && grep -qF 'preserving residue' "$L_OUT_FILE" 2>/dev/null; then
      printf 'error: loader reported ambiguous identity; preserving exact residue %s\n' "$RUNDIR" >&2
      PRESERVE_RESIDUE="1"
    fi
    kill -- "$LOSS_JOB" 2>/dev/null || true
    wait "$LOSS_JOB" 2>/dev/null || true
    stop_follower
    cleanup_all "$loader" || true
    fail "loss marker wait failed"
  }
  # Owner loss must follow a still-live loss loader: prove the background
  # job is live with the pinned non-zombie start-tick immediately before
  # the exact Planner stop. An early exit preserves the residue and fails.
  local LOSS_TICK_NOW=""
  LOSS_TICK_NOW="$(real_proc_start_tick "$LOSS_JOB" 2>/dev/null)" || {
    printf 'error: loss loader job exited before owner loss; preserving exact residue %s\n' "$RUNDIR" >&2
    PRESERVE_RESIDUE="1"
    kill -- "$LOSS_JOB" 2>/dev/null || true
    wait "$LOSS_JOB" 2>/dev/null || true
    stop_follower
    cleanup_all "$loader" || true
    fail "loss loader exited before exact planner stop"
  }
  [[ "$LOSS_TICK_NOW" == "$LOSS_TICK" ]] || {
    printf 'error: loss loader PID/start-tick drift before owner loss; preserving exact residue %s\n' "$RUNDIR" >&2
    PRESERVE_RESIDUE="1"
    kill -- "$LOSS_JOB" 2>/dev/null || true
    wait "$LOSS_JOB" 2>/dev/null || true
    stop_follower
    cleanup_all "$loader" || true
    fail "loss loader identity drift before exact planner stop"
  }
  exact_planner_stop || {
    kill -- "$LOSS_JOB" 2>/dev/null || true
    wait "$LOSS_JOB" 2>/dev/null || true
    stop_follower
    cleanup_all "$loader" || true
    exit 1
  }
  prove_planner_owner_loss || {
    kill -- "$LOSS_JOB" 2>/dev/null || true
    wait "$LOSS_JOB" 2>/dev/null || true
    stop_follower
    cleanup_all "$loader" || true
    exit 1
  }
  local LOSS_RC=0
  wait "$LOSS_JOB" || LOSS_RC=$?
  stop_follower
  if grep -qF 'ambiguous' "$L_OUT_FILE" 2>/dev/null && grep -qF 'preserving residue' "$L_OUT_FILE" 2>/dev/null; then
    printf 'error: loader reported ambiguous identity; preserving exact residue %s\n' "$RUNDIR" >&2
    PRESERVE_RESIDUE="1"
  fi
  [[ "$LOSS_RC" -eq 0 ]] || {
    cleanup_all "$loader" || true
    fail "loss refusal transport failed"
  }
  local L_OUT=""
  L_OUT="$(cat -- "$L_OUT_FILE")" || {
    cleanup_all "$loader" || true
    fail "loss refusal output is unreadable"
  }
  [[ "$L_OUT" == *"detail=$TIMEOUT_DETAIL"* && "$L_OUT" == *"after=true"* ]] || {
    cleanup_all "$loader" || true
    fail "loss refusal bound the wrong detail/after pair"
  }
  [[ ! -e "$L_RECEIPT" && ! -L "$L_RECEIPT" ]] || {
    cleanup_all "$loader" || true
    fail "loss refusal must leave no receipt"
  }
  PHASE_DONE="success,stale,loss"

  # Post-phase KWin and production continuity through loader checks.
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
  for phase in success stale loss; do
    local phase_bundle="$RUNDIR/$phase/advisory-describe.js"
    local phase_manifest="$RUNDIR/$phase/advisory-describe.manifest.json"
    local phase_input="$RUNDIR/$phase/request.json"
    PREFLIGHT_AFTER="$(loader_preflight "$loader" "$phase_bundle" "$phase_manifest" "$phase_input")" || {
      cleanup_all "$loader" || true
      fail "post-phase loader preflight failed for $phase"
    }
    [[ -n "$PREFLIGHT_AFTER" ]] || {
      cleanup_all "$loader" || true
      fail "post-phase loader preflight emitted no identity for $phase"
    }
  done

  cleanup_all "$loader" || exit 1
  printf 'transport-sequencer: phases=%s success=%s stale=%s loss=%s continuity=verified\n' \
    "$PHASE_DONE" "$NONCE_SUCCESS" "$NONCE_STALE" "$NONCE_LOSS"
}

main() {
  [[ $# -ge 1 ]] || { usage >&2; exit 1; }
  case "$1" in
    --help|-h|help) usage; exit 0 ;;
    run) shift; cmd_run "$@" ;;
    *) printf 'error: unknown command (expected run)\n' >&2; exit 1 ;;
  esac
}

main "$@"
