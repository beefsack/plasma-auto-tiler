#!/usr/bin/env bash
# Focused acceptance for the advisory DescribeAdvisoryPlan host lifecycle.
# Static-only: the loader is never pointed at live KWin/Plasma. All bus
# contact goes through a fake BUSCTL_BIN fixture; diag evidence comes from
# temp files; the real bundle plus manifest are built once into kwin/dist
# and removed before exit (ignored/untracked).
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
LOADER="$REPO_ROOT/scripts/advisory-describe-host.sh"
BUILDER="$REPO_ROOT/scripts/advisory-describe-build.mjs"
BUNDLE="$REPO_ROOT/kwin/dist/advisory-describe.js"
MANIFEST="$REPO_ROOT/kwin/dist/advisory-describe.manifest.json"
PASS=0
FAIL=0

TMP_DIR=""
cleanup() {
  rm -f -- "$BUNDLE" "$MANIFEST" 2>/dev/null || true
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then rm -rf -- "$TMP_DIR" 2>/dev/null || true; fi
}
trap cleanup EXIT

TMP_DIR="$(mktemp -d)"
FAKE_DIR="$TMP_DIR/fake"
FAKE_BIN="$TMP_DIR/fakebin"
mkdir -p -- "$FAKE_DIR" "$FAKE_BIN"

pass() { PASS=$((PASS + 1)); printf 'pass: %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'fail: %s\n' "$1"; }

assert_contains() {
  local file="$1" text="$2"
  if grep -qF -- "$text" "$file"; then pass "contains: $text"; else fail "missing: $text"; fi
}

assert_absent() {
  local file="$1" text="$2"
  if grep -qF -- "$text" "$file"; then fail "forbidden present: $text"; else pass "absent: $text"; fi
}

if bash -n "$LOADER" >/dev/null 2>&1; then pass "bash -n loader"; else fail "bash -n loader"; fi
if bash -n "$REPO_ROOT/scripts/advisory-describe-host.test.sh" >/dev/null 2>&1; then pass "bash -n self"; else fail "bash -n self"; fi
assert_contains "$LOADER" '"$BUSCTL_BIN" "$BUS_SCOPE" introspect'

# Narrow project-namespaced interface with receipt-scoped commands.
assert_contains "$LOADER" 'PLUGIN="plasma-auto-tiler-advisory-describe"'
assert_contains "$LOADER" 'preflight --bundle B --manifest M --input I'
assert_contains "$LOADER" 'start --bundle B --manifest M --receipt R --diag-file D --input I'
assert_contains "$LOADER" 'status --receipt R'
assert_contains "$LOADER" 'diagnostics --receipt R'
assert_contains "$LOADER" 'stop --receipt R'
assert_contains "$LOADER" '--expected-planner-owner'
assert_contains "$LOADER" 'check_planner_present_owner'
assert_contains "$LOADER" 'valid_planner_unique_owner'
assert_contains "$LOADER" 'cmd_preflight'
assert_contains "$LOADER" 'parse_preflight_args'
assert_contains "$LOADER" 'planner unique owner mismatch'
assert_contains "$LOADER" 'planner unique owner drift after lifecycle'
assert_contains "$LOADER" 'preflight: bundle='
# Exact transport: loadScript with the exact bundle, introspect and run only
# the returned exact object, strict canonical id parsing incl. 0.
assert_contains "$LOADER" 'loadScript ss "$START_BUNDLE" "$PLUGIN"'
assert_contains "$LOADER" '/Scripting/Script$SCRIPT_ID'
assert_contains "$LOADER" 'introspect "$BUS_DEST" "$SCRIPT_OBJ"'
assert_contains "$LOADER" '"$BUS_SCRIPT_IFACE" run'
assert_contains "$LOADER" '(0|[1-9][0-9]*)'
assert_contains "$LOADER" '-le 2147483647'
assert_contains "$LOADER" 'unloadScript s "$PLUGIN"'
assert_contains "$LOADER" 'unloadScript s "$RECEIPT_PLUGIN"'
assert_contains "$LOADER" 'org.kde.kwin.Script'
assert_contains "$LOADER" 'advisory-describe-ready'
assert_contains "$LOADER" 'advisory-describe-result'
assert_contains "$LOADER" 'advisory-describe-after'
assert_contains "$LOADER" 'advisory-describe-source'
assert_contains "$LOADER" 'RESULT_SCHEMA="v1"'
assert_contains "$LOADER" 'AFTER_SCHEMA="v1"'
assert_contains "$LOADER" 'check_result_line'
assert_contains "$LOADER" 'check_after_line'
assert_contains "$LOADER" 'after_prefix_for'
assert_contains "$LOADER" 'STALE_DETAIL'
assert_contains "$LOADER" 'could-execute'
assert_contains "$LOADER" 'result_offset'
assert_contains "$LOADER" 'after_start'
assert_contains "$LOADER" 'not observed after the result'
assert_contains "$LOADER" 'receipt requires could-execute with after true'
assert_contains "$LOADER" 'source_line_for'
assert_contains "$LOADER" 'require_receipt_parent'
assert_contains "$LOADER" 'noclobber'
assert_contains "$LOADER" 'node_parse_json_file'
assert_contains "$LOADER" '--verify'
assert_contains "$LOADER" 'already loaded'
assert_contains "$LOADER" 'AdvisoryPlanQuery'
assert_contains "$LOADER" 'DescribeAdvisoryPlan'
assert_contains "$LOADER" 'MANIFEST_BUNDLE_SHA'
assert_contains "$LOADER" 'MANIFEST_INPUT_SHA'
assert_contains "$LOADER" 'MANIFEST_SNAPSHOT_SHA'
assert_contains "$LOADER" 'RECEIPT_SNAPSHOT_SHA'
assert_contains "$LOADER" 'partial script-id='
assert_contains "$LOADER" 'ambiguous loadScript identity'
assert_contains "$LOADER" 'preserving residue with no cleanup'
# Host-contact tools are pinned via BIN vars; no bare bus/systemctl contact.
assert_contains "$LOADER" '"$BUSCTL_BIN"'
assert_contains "$LOADER" '"$SYSTEMCTL_BIN"'
if grep -v '^[[:space:]]*#' "$LOADER" | grep -w -F 'busctl' | grep -v -F 'BUSCTL_BIN' > /dev/null; then
  fail "host busctl contact must be pinned via BUSCTL_BIN"
else
  pass "host busctl contact is pinned via BUSCTL_BIN"
fi
if grep -v '^[[:space:]]*#' "$LOADER" | grep -w -F 'systemctl' | grep -v -F 'SYSTEMCTL_BIN' | grep -v -F 'systemctl-show' > /dev/null; then
  fail "host systemctl contact must be pinned via SYSTEMCTL_BIN"
else
  pass "host systemctl contact is pinned via SYSTEMCTL_BIN"
fi
assert_absent "$LOADER" 'Script0'
assert_contains "$LOADER" 'PRODUCTION_PLUGIN="plasma-auto-tiler-kwin"'
assert_contains "$LOADER" 'PLANNER_SERVICE="org.plasmaautotiler.Planner"'
assert_contains "$LOADER" 'scripts/poc3-host-kwin-identity.sh'
assert_contains "$LOADER" 'poc3_kwin_systemd_fallback'
assert_contains "$LOADER" 'poc3_kwin_direct_parent_fallback'
assert_contains "$LOADER" 'kwin_unique_owner'
assert_contains "$LOADER" 'kwin_pid_for_owner'
assert_contains "$LOADER" 'proc_start_tick'
assert_contains "$LOADER" 'kwin_identity_once'
assert_contains "$LOADER" '"$rc" -eq 42'
assert_contains "$LOADER" 'check_planner_absent'
assert_contains "$LOADER" 'NameHasOwner'
assert_contains "$LOADER" 'GetNameOwner'
assert_contains "$LOADER" 'GetConnectionUnixProcessID'
assert_contains "$LOADER" '--json=short'
assert_contains "$LOADER" 'KWin executable drift detected'
assert_contains "$LOADER" 'KWin identity source drift detected'
assert_contains "$LOADER" 'KWin identity recapture failed'
assert_contains "$LOADER" 'RE_EXE'
assert_contains "$LOADER" 'RE_SOURCE'
assert_contains "$LOADER" 'must be loaded before advisory start'
assert_contains "$LOADER" 'drift detected'
assert_absent "$LOADER" 'queryWindowInfo'
assert_absent "$LOADER" 'Scripting start'
assert_absent "$LOADER" 'nested-'
# Planner absence must fail closed on NameHasOwner boolean, never on a failed
# GetNameOwner. The planner check must not call GetNameOwner.
if grep -A30 -F 'check_planner_absent()' "$LOADER" | grep -F 'GetNameOwner' > /dev/null; then
  fail "planner absence must not rely on GetNameOwner"
else
  pass "planner absence avoids GetNameOwner"
fi
# Strict present-owner resolver must require the full chain.
if grep -A80 -F 'check_planner_present_owner()' "$LOADER" | grep -F 'NameHasOwner' > /dev/null; then
  pass "present-owner requires NameHasOwner true"
else
  fail "present-owner requires NameHasOwner true"
fi
if grep -A80 -F 'check_planner_present_owner()' "$LOADER" | grep -F 'GetNameOwner' > /dev/null; then
  pass "present-owner requires GetNameOwner equality"
else
  fail "present-owner requires GetNameOwner equality"
fi
if grep -A120 -F 'check_planner_present_owner()' "$LOADER" | grep -F 'GetConnectionUnixProcessID' > /dev/null; then
  pass "present-owner requires GetConnectionUnixProcessID"
else
  fail "present-owner requires GetConnectionUnixProcessID"
fi
if grep -A150 -F 'check_planner_present_owner()' "$LOADER" | grep -F 'proc_start_tick' > /dev/null; then
  pass "present-owner requires PID/start tick"
else
  fail "present-owner requires PID/start tick"
fi
# Default start must preserve the absent requirement; expected mode skips only it.
assert_contains "$LOADER" 'check_planner_absent || exit 1'
assert_contains "$LOADER" 'check_planner_present_owner "$START_EXPECTED_PLANNER_OWNER"'
assert_contains "$LOADER" 'check_planner_present_owner "$PRE_EXPECTED_PLANNER_OWNER"'
assert_contains "$LOADER" 'is absent; refusing without the expected present owner'
# No Planner launch/kill, no journald, no generic runtime directory.
assert_absent "$LOADER" 'journalctl'
assert_absent "$LOADER" 'journald'
assert_absent "$LOADER" 'planner-launch'
assert_absent "$LOADER" 'planner-kill'
assert_absent "$LOADER" 'systemd-run'
assert_absent "$LOADER" 'XDG_RUNTIME_DIR'
if grep -v '^[[:space:]]*#' "$LOADER" | grep -F 'RuntimeDirectory=' > /dev/null; then
  fail "no runtime directory in loader"
else
  pass "no runtime directory in loader"
fi
# Direct-parent fallback only on the fixed MainPID-mismatch status, never by
# matching stderr text.
if grep -v '^[[:space:]]*#' "$LOADER" | grep -F 'does not match KWin PID' > /dev/null; then
  fail "direct-parent avoids stderr matching"
else
  pass "direct-parent avoids stderr matching"
fi
if grep -v '^[[:space:]]*#' "$LOADER" | grep -F '"$rc" -eq 42' > /dev/null; then
  pass "direct-parent routes on the fixed mismatch status"
else
  fail "direct-parent routes on the fixed mismatch status"
fi
IDENTITY_HELPER="$REPO_ROOT/scripts/poc3-host-kwin-identity.sh"
if grep -Fq 'mktemp' "$IDENTITY_HELPER"; then
  fail "sourced identity helper creates no temp files"
else
  pass "sourced identity helper creates no temp files"
fi
# Only the approved helper route may mention poc3 identity helpers.
if grep -F 'poc3_' "$LOADER" | grep -Fv -e 'poc3_kwin_systemd_fallback' -e 'poc3_kwin_direct_parent_fallback' > /dev/null; then
  fail "only approved poc3 helper route present"
else
  pass "only approved poc3 helper route present"
fi
if grep -F 'scripts/poc3' "$LOADER" | grep -Fv 'scripts/poc3-host-kwin-identity.sh' > /dev/null; then
  fail "only approved poc3 helper source present"
else
  pass "only approved poc3 helper source present"
fi
# Resource-free static detection: pre-verify section (comments excluded) must
# contain no mktemp/mkdtemp/mkdir/touch and no file-creating redirection.
PREVERIFY_SECT="$TMP_DIR/preverify-sect.txt"
sed -n '/^cmd_start() {/,/"\$NODE_BIN" -- "\$BUILDER" --verify/p' "$LOADER" \
  | grep -v '^[[:space:]]*#' > "$PREVERIFY_SECT"
for _tok in mktemp mkdtemp mkdir touch; do
  if grep -wq -- "$_tok" "$PREVERIFY_SECT"; then fail "pre-verify has no $_tok"; else pass "pre-verify has no $_tok"; fi
done
# File-creating redirection before verify: look for >" / >$ / >> outside of
# >&2, 2>/dev/null, 2>&1, >/dev/null.
if grep -E '(^|[^>&0-9])>>( |"|\$|/)' "$PREVERIFY_SECT" >/dev/null 2>&1; then
  fail "pre-verify has no file-append redirection"
else
  pass "pre-verify has no file-append redirection"
fi
if grep -E '(^|[^>&0-9])> ("|\$|/[^d])' "$PREVERIFY_SECT" 2>/dev/null | grep -v '/dev/null' | grep '.' > /dev/null; then
  fail "pre-verify has no file-create redirection"
else
  pass "pre-verify has no file-create redirection"
fi
if grep -v '^[[:space:]]*#' "$LOADER" | grep -F 'mktemp' > /dev/null; then
  fail "loader creates no temp files"
else
  pass "loader creates no temp files"
fi
# Preflight subcommand must be resource-free: no temp/dir creation in code.
PREFLIGHT_SECT="$TMP_DIR/preflight-sect.txt"
sed -n '/^cmd_preflight() {/,/^}/p' "$LOADER" \
  | grep -v '^[[:space:]]*#' > "$PREFLIGHT_SECT"
for _tok in mktemp mkdtemp mkdir touch; do
  if grep -wq -- "$_tok" "$PREFLIGHT_SECT"; then fail "preflight has no $_tok"; else pass "preflight has no $_tok"; fi
done
if grep -E '(^|[^>&0-9])>>( |"|\$|/)' "$PREFLIGHT_SECT" >/dev/null 2>&1; then
  fail "preflight has no file-append redirection"
else
  pass "preflight has no file-append redirection"
fi
if grep -E '(^|[^>&0-9])> ("|\$|/[^d])' "$PREFLIGHT_SECT" 2>/dev/null | grep -v '/dev/null' | grep '.' > /dev/null; then
  fail "preflight has no file-create redirection"
else
  pass "preflight has no file-create redirection"
fi
if grep -v '^[[:space:]]*#' "$LOADER" | grep -F 'preflight.*mkdir' > /dev/null; then
  fail "preflight creates no runtime directory"
else
  pass "preflight creates no runtime directory"
fi
if grep -o 'unloadScript s "[^"]*"' "$LOADER" | sort -u | tr '\n' ' ' | grep -F 'unloadScript s "$PLUGIN" unloadScript s "$RECEIPT_PLUGIN"' > /dev/null; then
  pass "unload targets only the recorded plugin"
else
  fail "unload targets only the recorded plugin"
fi

# Fake busctl fixture: behavior driven only by files under FAKE_DIR, every
# invocation appended to calls.log plus the shared events.log for exact
# preflight-before-verify-before-load/run ordering assertions.
# Supports JSON owner/PID plus strict NameHasOwner planner boolean plus plain
# isScriptLoaded split by plugin (production vs advisory) so preflight
# collisions are observable with no live host contact.
cat > "$FAKE_BIN/busctl" <<'FAKE_BUSCTL'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_DIR/calls.log"
printf 'busctl %s\n' "$*" >> "$FAKE_DIR/events.log"
if printf '%s' "$*" | grep -Fq 'unloadScript'; then
  cat -- "$FAKE_DIR/unload_reply"
  exit "${FAKE_UNLOAD_EXIT:-0}"
fi
if printf '%s' "$*" | grep -Fq 'loadScript'; then
  cat -- "$FAKE_DIR/load_reply"
  exit "${FAKE_LOAD_EXIT:-0}"
fi
if [[ "${1:-}" == "--user" && "${2:-}" == "introspect" ]]; then
  cat -- "$FAKE_DIR/introspect_reply"
  exit "${FAKE_INTROSPECT_EXIT:-0}"
fi
if [[ "${1:-}" == "introspect" ]]; then
  echo "fake busctl: unscoped introspect" >&2
  exit 1
fi
if printf '%s' "$*" | grep -Fq 'NameHasOwner'; then
  if printf '%s' "$*" | grep -Fq 'org.plasmaautotiler.Planner'; then
    if [[ -f "$FAKE_DIR/planner-fail" ]]; then echo "fake busctl: planner NameHasOwner transport failure" >&2; exit 1; fi
    if [[ -f "$FAKE_DIR/bad-planner-reply" ]]; then cat -- "$FAKE_DIR/bad-planner-reply"; exit 0; fi
    if [[ -f "$FAKE_DIR/planner-owner" ]]; then printf '{"type":"b","data":[true]}'; exit 0; fi
    printf '{"type":"b","data":[false]}'
    exit 0
  fi
fi
if printf '%s' "$*" | grep -Fq 'GetNameOwner'; then
  if printf '%s' "$*" | grep -Fq 'org.plasmaautotiler.Planner'; then
    if [[ -f "$FAKE_DIR/bad-planner-owner-reply" ]]; then cat -- "$FAKE_DIR/bad-planner-owner-reply"; exit 0; fi
    if [[ -f "$FAKE_DIR/planner-owner-seq" && -s "$FAKE_DIR/planner-owner-seq" ]]; then
      line="$(head -n 1 -- "$FAKE_DIR/planner-owner-seq")"
      tail -n +2 -- "$FAKE_DIR/planner-owner-seq" > "$FAKE_DIR/planner-owner-seq.tmp" 2>/dev/null || true
      mv -- "$FAKE_DIR/planner-owner-seq.tmp" "$FAKE_DIR/planner-owner-seq" 2>/dev/null || true
      printf '{"type":"s","data":["%s"]}' "$line"
      exit 0
    fi
    if [[ -f "$FAKE_DIR/planner-owner" ]]; then
      planner_now="$(head -n 1 -- "$FAKE_DIR/planner-owner" | tr -d '\r ')"
      printf '{"type":"s","data":["%s"]}' "$planner_now"
      exit 0
    fi
    echo "fake busctl: planner has no owner" >&2
    exit 1
  fi
  if printf '%s' "$*" | grep -Fq 'org.kde.KWin'; then
    if [[ -f "$FAKE_DIR/bad-owner-reply" ]]; then cat -- "$FAKE_DIR/bad-owner-reply"; exit 0; fi
    if [[ -f "$FAKE_DIR/owner-seq" && -s "$FAKE_DIR/owner-seq" ]]; then
      line="$(head -n 1 -- "$FAKE_DIR/owner-seq")"
      tail -n +2 -- "$FAKE_DIR/owner-seq" > "$FAKE_DIR/owner-seq.tmp" 2>/dev/null || true
      mv -- "$FAKE_DIR/owner-seq.tmp" "$FAKE_DIR/owner-seq" 2>/dev/null || true
      printf '{"type":"s","data":["%s"]}' "$line"
      exit 0
    fi
    printf '{"type":"s","data":["%s"]}' "$(cat -- "$FAKE_DIR/kwin-owner")"
    exit 0
  fi
fi
if printf '%s' "$*" | grep -Fq 'GetConnectionUnixProcessID'; then
  last="${*: -1}"
  kwin_owner_now="$(tr -d '\r\n ' < "$FAKE_DIR/kwin-owner" 2>/dev/null || printf '')"
  if [[ -n "$kwin_owner_now" && "$last" != "$kwin_owner_now" && "$last" == :* ]]; then
    if [[ -f "$FAKE_DIR/bad-planner-pid-reply" ]]; then cat -- "$FAKE_DIR/bad-planner-pid-reply"; exit 0; fi
    if [[ -f "$FAKE_DIR/planner-pid-seq" && -s "$FAKE_DIR/planner-pid-seq" ]]; then
      line="$(head -n 1 -- "$FAKE_DIR/planner-pid-seq")"
      tail -n +2 -- "$FAKE_DIR/planner-pid-seq" > "$FAKE_DIR/planner-pid-seq.tmp" 2>/dev/null || true
      mv -- "$FAKE_DIR/planner-pid-seq.tmp" "$FAKE_DIR/planner-pid-seq" 2>/dev/null || true
      printf '{"type":"u","data":[%s]}' "$line"
      exit 0
    fi
    if [[ -f "$FAKE_DIR/planner-pid" ]]; then
      printf '{"type":"u","data":[%s]}' "$(cat -- "$FAKE_DIR/planner-pid")"
      exit 0
    fi
    echo "fake busctl: unknown planner owner $last" >&2
    exit 1
  fi
  if [[ -f "$FAKE_DIR/bad-pid-reply" ]]; then cat -- "$FAKE_DIR/bad-pid-reply"; exit 0; fi
  if [[ -f "$FAKE_DIR/pid-seq" && -s "$FAKE_DIR/pid-seq" ]]; then
    line="$(head -n 1 -- "$FAKE_DIR/pid-seq")"
    tail -n +2 -- "$FAKE_DIR/pid-seq" > "$FAKE_DIR/pid-seq.tmp" 2>/dev/null || true
    mv -- "$FAKE_DIR/pid-seq.tmp" "$FAKE_DIR/pid-seq" 2>/dev/null || true
    printf '{"type":"u","data":[%s]}' "$line"
    exit 0
  fi
  printf '{"type":"u","data":[%s]}' "$(cat -- "$FAKE_DIR/kwin-pid")"
  exit 0
fi
if printf '%s' "$*" | grep -Fq 'isScriptLoaded'; then
  if printf '%s' "$*" | grep -Fq 'plasma-auto-tiler-kwin'; then
    cat -- "$FAKE_DIR/prod_reply"
    exit 0
  fi
  if [[ -f "$FAKE_DIR/is_loaded_queue" && -s "$FAKE_DIR/is_loaded_queue" ]]; then
    line="$(head -n 1 -- "$FAKE_DIR/is_loaded_queue")"
    tail -n +2 -- "$FAKE_DIR/is_loaded_queue" > "$FAKE_DIR/is_loaded_queue.tmp" 2>/dev/null || true
    mv -- "$FAKE_DIR/is_loaded_queue.tmp" "$FAKE_DIR/is_loaded_queue" 2>/dev/null || true
    printf '%s' "$line"
    exit 0
  fi
  if [[ -f "$FAKE_DIR/is_loaded_seq" ]]; then
    n="$(cat -- "$FAKE_DIR/is_loaded_count" 2>/dev/null || printf '0')"
    printf '%s' "$((n + 1))" > "$FAKE_DIR/is_loaded_count"
    if [[ "$n" -eq 0 ]]; then printf 'b true'; else printf 'b false'; fi
    exit 0
  fi
  cat -- "$FAKE_DIR/is_loaded_reply"
  exit 0
fi
if [[ "${*: -1}" == "run" ]]; then
  if [[ "${FAKE_APPEND:-1}" == "1" ]]; then
    if [[ "${FAKE_ORDER:-in-order}" == "after-first" ]]; then
      printf '%s\n' "${FAKE_SOURCE:-}" "${FAKE_READY:-}" "${FAKE_AFTER:-}" "${FAKE_RESULT:-}" >> "${FAKE_DIAG:-/dev/null}"
    else
      printf '%s\n' "${FAKE_SOURCE:-}" "${FAKE_READY:-}" "${FAKE_RESULT:-}" "${FAKE_AFTER:-}" >> "${FAKE_DIAG:-/dev/null}"
    fi
  fi
  exit "${FAKE_RUN_EXIT:-0}"
fi
if [[ "${*: -1}" == "stop" ]]; then
  exit "${FAKE_STOP_EXIT:-0}"
fi
exit 1
FAKE_BUSCTL
chmod +x -- "$FAKE_BIN/busctl"

# Fake systemctl fixture: only the exact read-only unit show, driven by
# FAKE_DIR/systemctl-show. Absent file means fallback failure (fail closed).
# Every invocation is logged for direct-parent gating assertions.
cat > "$FAKE_BIN/systemctl" <<'FAKE_SYSTEMCTL'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_DIR/systemctl.log"
printf 'systemctl %s\n' "$*" >> "$FAKE_DIR/events.log"
joined="$*"
case "$joined" in
  *"show plasma-kwin_wayland.service"*) ;;
  *) echo "fake systemctl: unexpected call: $joined" >&2; exit 1 ;;
esac
[[ -f "$FAKE_DIR/systemctl-show" ]] || { echo "fake systemctl: unit unavailable" >&2; exit 1; }
cat -- "$FAKE_DIR/systemctl-show"
FAKE_SYSTEMCTL
chmod +x -- "$FAKE_BIN/systemctl"

# Fake node shim: logs builder --verify invocations to builder.log plus the
# shared events.log for ordering assertions, then delegates to real node.
REAL_NODE="$(command -v node)"
cat > "$FAKE_BIN/node" <<FAKE_NODE
#!/usr/bin/env bash
for a in "\$@"; do
  if [[ "\$a" == "--verify" ]]; then printf '%s\n' "\$*" >> "$FAKE_DIR/builder.log"; printf 'node --verify %s\n' "\$*" >> "$FAKE_DIR/events.log"; break; fi
done
exec "$REAL_NODE" "\$@"
FAKE_NODE
chmod +x -- "$FAKE_BIN/node"

export BUSCTL_BIN="$FAKE_BIN/busctl"
export SYSTEMCTL_BIN="$FAKE_BIN/systemctl"
export NODE_BIN="$FAKE_BIN/node"
export FAKE_DIR
export FAKE_DIAG="$TMP_DIR/diag.log"
export FAKE_APPEND=1
FAKE_PKG_ROOT="$TMP_DIR/fake-pkg"
FAKE_LAUNCHER="$FAKE_PKG_ROOT/bin/kwin_wayland_wrapper"
FAKE_WRAPPED="$FAKE_PKG_ROOT/bin/.kwin_wayland_wrapper-wrapped"
FAKE_PROC="$TMP_DIR/proc"
export PROC_ROOT="$FAKE_PROC"
export POC3_KWIN_IDENTITY_TEST_ALLOW_NONPROC=1
export POC3_KWIN_IDENTITY_TEST_ALLOW_NONSTORE=1

proc_fixture() {
  local pid="$1" tick="$2" exe="$3" ppid="${4:-1}"
  local dir="$FAKE_PROC/$pid"
  mkdir -p -- "$dir"
  local fields="S"
  fields+=" $ppid"
  local k
  for ((k = 1; k < 18; k += 1)); do fields+=' 0'; done
  fields+=" $tick"
  # stat layout: pid (comm) state ppid ... starttick ; ppid is field 4.
  printf '%s (kwin_wayland) %s\n' "$pid" "$fields" > "$dir/stat"
  rm -f -- "$dir/exe"
  ln -s -- "$exe" "$dir/exe"
  printf '0::/\n' > "$dir/cgroup"
}

write_systemctl_show() {
  local exec_path="$1" mainpid="${2:-4242}"
  cat > "$FAKE_DIR/systemctl-show" <<EOF
Id=plasma-kwin_wayland.service
ActiveState=active
SubState=running
MainPID=$mainpid
Type=dbus
BusName=org.kde.KWinWrapper
ExecStart={ path=$exec_path ; argv[]=$exec_path --socket test ; ignore=no }
FragmentPath=/run/systemd/user/plasma-kwin_wayland.service
SourcePath=
EOF
}

setup_kwin_identity() {
  local mainpid="${1:-4242}"
  mkdir -p -- "$FAKE_PKG_ROOT/bin" "$FAKE_PROC/sys/kernel/random"
  rm -f -- "$FAKE_LAUNCHER" "$FAKE_WRAPPED"
  printf 'launcher-fixture\n' > "$FAKE_LAUNCHER"
  chmod 555 -- "$FAKE_LAUNCHER"
  printf 'wrapped-fixture\n' > "$FAKE_WRAPPED"
  chmod 555 -- "$FAKE_WRAPPED"
  printf '12345678-1234-1234-1234-123456789abc\n' > "$FAKE_PROC/sys/kernel/random/boot_id"
  printf ':1.10\n' > "$FAKE_DIR/kwin-owner"
  printf '%s\n' "$mainpid" > "$FAKE_DIR/kwin-pid"
  rm -f -- "$FAKE_DIR/owner-seq" "$FAKE_DIR/pid-seq" "$FAKE_DIR/bad-owner-reply" "$FAKE_DIR/bad-pid-reply" "$FAKE_DIR/planner-owner" "$FAKE_DIR/bad-planner-reply" "$FAKE_DIR/planner-fail"
  rm -f -- "$FAKE_DIR/planner-owner-seq" "$FAKE_DIR/planner-pid" "$FAKE_DIR/planner-pid-seq" "$FAKE_DIR/bad-planner-owner-reply" "$FAKE_DIR/bad-planner-pid-reply"
  rm -rf -- "$FAKE_PROC/4242" "$FAKE_PROC/4243" "$FAKE_PROC/4343" "$FAKE_PROC/4344" "$FAKE_PROC/9999"
  proc_fixture "$mainpid" 424200 "$FAKE_WRAPPED" 1
  write_systemctl_show "$FAKE_LAUNCHER" "$mainpid"
}

setup_planner_present() {
  local owner="${1:-:1.99}" pid="${2:-4343}" tick="${3:-434300}"
  printf '%s\n' "$owner" > "$FAKE_DIR/planner-owner"
  printf '%s\n' "$pid" > "$FAKE_DIR/planner-pid"
  rm -f -- "$FAKE_DIR/planner-owner-seq" "$FAKE_DIR/planner-pid-seq" "$FAKE_DIR/bad-planner-owner-reply" "$FAKE_DIR/bad-planner-pid-reply" "$FAKE_DIR/bad-planner-reply" "$FAKE_DIR/planner-fail"
  rm -rf -- "$FAKE_PROC/$pid"
  proc_fixture "$pid" "$tick" "$FAKE_WRAPPED" 1
}

reset_fake() {
  rm -f -- "$FAKE_DIR/calls.log" "$FAKE_DIR/builder.log" "$FAKE_DIR/events.log" "$FAKE_DIR/systemctl.log" "$FAKE_DIR/is_loaded_count" "$FAKE_DIR/is_loaded_seq" "$FAKE_DIR/is_loaded_queue"
  rm -f -- "$FAKE_DIR/owner-seq" "$FAKE_DIR/pid-seq" "$FAKE_DIR/bad-owner-reply" "$FAKE_DIR/bad-pid-reply" "$FAKE_DIR/planner-owner" "$FAKE_DIR/bad-planner-reply" "$FAKE_DIR/planner-fail"
  rm -f -- "$FAKE_DIR/planner-owner-seq" "$FAKE_DIR/planner-pid" "$FAKE_DIR/planner-pid-seq" "$FAKE_DIR/bad-planner-owner-reply" "$FAKE_DIR/bad-planner-pid-reply"
  : > "$FAKE_DIR/events.log"
  : > "$FAKE_DIR/calls.log"
  rm -rf -- "$TMP_DIR/guard-tmp"
  mkdir -p -- "$TMP_DIR/guard-tmp"
  export TMPDIR="$TMP_DIR/guard-tmp"
  printf 'i 3' > "$FAKE_DIR/load_reply"
  printf 'interface org.kde.kwin.Script { };' > "$FAKE_DIR/introspect_reply"
  printf 'b false' > "$FAKE_DIR/is_loaded_reply"
  printf 'b true' > "$FAKE_DIR/prod_reply"
  printf 'b true' > "$FAKE_DIR/unload_reply"
  FAKE_LOAD_EXIT=0; FAKE_INTROSPECT_EXIT=0; FAKE_RUN_EXIT=0; FAKE_STOP_EXIT=0; FAKE_UNLOAD_EXIT=0
  export FAKE_LOAD_EXIT FAKE_INTROSPECT_EXIT FAKE_RUN_EXIT FAKE_STOP_EXIT FAKE_UNLOAD_EXIT
  FAKE_ORDER="in-order"; export FAKE_ORDER
  setup_kwin_identity 4242
}

queue_loaded() {
  rm -f -- "$FAKE_DIR/is_loaded_queue"
  for word in "$@"; do printf '%s\n' "$word" >> "$FAKE_DIR/is_loaded_queue"; done
}

NONCE="$(printf '%s-%s-%s' "$RANDOM" "$$" "$(date +%s%N)" | sha256sum | cut -d' ' -f1 | head -c 64)"
OWNER="adv-host-owner"
GENERATION="adv-host-gen"
REVISION="9"
NONCE2="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
READY="plasma-auto-tiler:advisory-describe-ready:$NONCE"
RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute:R2a:swap-neighbor"
AFTER="plasma-auto-tiler:advisory-describe-after:v1:$NONCE:true"
STALE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:reject:advisory-stale-snapshot"
AFTER_FALSE="plasma-auto-tiler:advisory-describe-after:v1:$NONCE:false"

NONCE="$NONCE" OWNER="$OWNER" GENERATION="$GENERATION" REVISION="$REVISION" node -e '
const record = {
  nonce: process.env.NONCE,
  correlationId: process.env.NONCE,
  owner: process.env.OWNER,
  generation: process.env.GENERATION,
  revision: Number(process.env.REVISION),
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
require("node:fs").writeFileSync(process.argv[1], JSON.stringify(record));
' "$TMP_DIR/request.json"

if node "$BUILDER" --input "$TMP_DIR/request.json" --out "$BUNDLE" >/dev/null 2>&1; then
  pass "fixture bundle built"
else
  fail "fixture bundle built"
fi

seed_diag() {
  printf 'pre-run padding line\n' > "$TMP_DIR/diag.log"
  local entry_sha query_sha snapshot_sha
  entry_sha="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-describe-entry.ts" | cut -d' ' -f1)"
  query_sha="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-plan-query.ts" | cut -d' ' -f1)"
  snapshot_sha="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-snapshot.ts" | cut -d' ' -f1)"
  FAKE_SOURCE="plasma-auto-tiler:advisory-describe-source:$entry_sha:$query_sha:$snapshot_sha"
  FAKE_READY="$READY"
  FAKE_RESULT="$RESULT"
  FAKE_AFTER="$AFTER"
  FAKE_APPEND=1
  export FAKE_SOURCE FAKE_READY FAKE_RESULT FAKE_AFTER FAKE_APPEND
}

start_args() {
  printf '%s\n' --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$1" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 5 --delay 0.01
}

# 1: start success with a valid non-zero id.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r1.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 5 --delay 0.01 > "$TMP_DIR/o1" 2>&1; then
  pass "start accepts valid id 3"
else
  fail "start accepts valid id 3"
fi
if grep -qF '"scriptId":3' "$TMP_DIR/r1.json" && grep -qF '"/Scripting/Script3"' "$TMP_DIR/r1.json"; then
  pass "receipt records the exact id and object"
else
  fail "receipt records the exact id and object"
fi
if grep -qF "loadScript ss $BUNDLE plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log" \
  && grep -qF -- "--user introspect org.kde.KWin /Scripting/Script3" "$FAKE_DIR/calls.log" \
  && grep -qF "/Scripting/Script3 org.kde.kwin.Script run" "$FAKE_DIR/calls.log"; then
  pass "exact Script path and object run"
else
  fail "exact Script path and object run"
fi
if grep -qF 'isScriptLoaded s plasma-auto-tiler-kwin' "$FAKE_DIR/calls.log"; then pass "production load state proven read-only on start"; else fail "production load state proven read-only on start"; fi
if grep -qF 'unloadScript s plasma-auto-tiler-kwin' "$FAKE_DIR/calls.log" || grep -qF "loadScript ss $BUNDLE plasma-auto-tiler-kwin" "$FAKE_DIR/calls.log"; then fail "production never mutated on start"; else pass "production never mutated on start"; fi
if grep -qF 'Scripting start' "$FAKE_DIR/calls.log"; then fail "no global start on start"; else pass "no global start on start"; fi
if grep -qF -- '--verify' "$FAKE_DIR/builder.log"; then pass "builder verify ran after preflight on success"; else fail "builder verify ran after preflight on success"; fi
if grep -qF 'GetNameOwner' "$FAKE_DIR/calls.log" && grep -qF 'GetConnectionUnixProcessID' "$FAKE_DIR/calls.log"; then pass "KWin owner/PID preflight ran before lifecycle"; else fail "KWin owner/PID preflight ran before lifecycle"; fi
if grep -qF 'NameHasOwner' "$FAKE_DIR/calls.log"; then pass "planner NameHasOwner preflight ran"; else fail "planner NameHasOwner preflight ran"; fi
# Shared event ordering: full preflight precedes --verify, which precedes load/run.
assert_event_order() {
  local label="$1"
  local ev="$FAKE_DIR/events.log"
  local n_pre n_verify n_load n_run
  n_pre="$(grep -nF 'NameHasOwner' "$ev" 2>/dev/null | head -n 1 | cut -d: -f1)"
  [[ -n "$n_pre" ]] || { fail "ordering $label misses planner preflight"; return 0; }
  local n_owner n_pid n_prod
  n_owner="$(grep -nF 'GetNameOwner' "$ev" 2>/dev/null | head -n 1 | cut -d: -f1)"
  n_pid="$(grep -nF 'GetConnectionUnixProcessID' "$ev" 2>/dev/null | head -n 1 | cut -d: -f1)"
  n_prod="$(grep -nF 'isScriptLoaded s plasma-auto-tiler-kwin' "$ev" 2>/dev/null | head -n 1 | cut -d: -f1)"
  n_verify="$(grep -nF -- '--verify' "$ev" 2>/dev/null | head -n 1 | cut -d: -f1)"
  n_load="$(grep -nF 'loadScript' "$ev" 2>/dev/null | head -n 1 | cut -d: -f1)"
  n_run="$(grep -nF 'org.kde.kwin.Script run' "$ev" 2>/dev/null | head -n 1 | cut -d: -f1)"
  [[ -n "$n_owner" && -n "$n_pid" && -n "$n_prod" && -n "$n_verify" && -n "$n_load" && -n "$n_run" ]] || { fail "ordering $label misses events"; return 0; }
  if [[ "$n_owner" -lt "$n_verify" && "$n_pid" -lt "$n_verify" && "$n_pre" -lt "$n_verify" && "$n_prod" -lt "$n_verify" && "$n_verify" -lt "$n_load" && "$n_load" -lt "$n_run" ]]; then
    pass "ordering $label preflight before verify before load/run"
  else
    fail "ordering $label preflight before verify before load/run"
  fi
}
assert_event_order "start-success"

# status and diagnostics against the recorded receipt only.
printf 'b true' > "$FAKE_DIR/is_loaded_reply"
if "$LOADER" status --receipt "$TMP_DIR/r1.json" > "$TMP_DIR/o-status" 2>&1 && grep -qF 'state=loaded' "$TMP_DIR/o-status"; then
  pass "status reports the recorded load state"
else
  fail "status reports the recorded load state"
fi
if "$LOADER" diagnostics --receipt "$TMP_DIR/r1.json" --diag-file "$TMP_DIR/diag.log" > "$TMP_DIR/o-diag" 2>&1 && grep -qF 'markers=correlated' "$TMP_DIR/o-diag"; then
  pass "diagnostics validates correlated markers"
else
  fail "diagnostics validates correlated markers"
fi

# stop unloads only the recorded exact id and removes the receipt.
reset_fake
queue_loaded "b true" "b false"
if "$LOADER" stop --receipt "$TMP_DIR/r1.json" > "$TMP_DIR/o-stop" 2>&1 && grep -qF 'cleanup=verified' "$TMP_DIR/o-stop"; then
  pass "stop unloads the exact recorded id"
else
  fail "stop unloads the exact recorded id"
fi
if [[ ! -e "$TMP_DIR/r1.json" ]]; then pass "receipt removed after verified stop"; else fail "receipt removed after verified stop"; fi
if grep -qF "/Scripting/Script3 org.kde.kwin.Script stop" "$FAKE_DIR/calls.log" && grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log"; then
  pass "stop hits only the exact object and plugin"
else
  fail "stop hits only the exact object and plugin"
fi
if grep -qF 'plasma-auto-tiler-kwin' "$FAKE_DIR/calls.log"; then fail "production untouched on stop"; else pass "production untouched on stop"; fi

# 2: valid id 0 is accepted (0 valid only when returned).
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
printf 'i 0' > "$FAKE_DIR/load_reply"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r0.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 5 --delay 0.01 >/dev/null 2>&1 \
  && grep -qF '"scriptId":0' "$TMP_DIR/r0.json" && grep -qF '"/Scripting/Script0"' "$TMP_DIR/r0.json"; then
  pass "start accepts valid id 0 with the exact object"
else
  fail "start accepts valid id 0 with the exact object"
fi

# 2b: canonical ids only - leading-zero forms rejected, 0 retained above.
for reply in "i 003" "i 00" "i 01" "i 0000003"; do
  reset_fake; seed_diag
  printf '%s' "$reply" > "$FAKE_DIR/load_reply"
  if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-canon.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
    fail "start must reject non-canonical id: $reply"
  else
    pass "start rejects non-canonical id: $reply"
  fi
  if [[ -e "$TMP_DIR/r-canon.json" ]]; then fail "no receipt on non-canonical id: $reply"; else pass "no receipt on non-canonical id: $reply"; fi
  rm -f -- "$TMP_DIR/r-canon.json"
done

# 3/4/5: -1, malformed, and out-of-range ids are rejected before transport.
for reply in "i -1" "s hello" "i 2147483648" "i 99999999999" "oops"; do
  reset_fake; seed_diag
  printf '%s' "$reply" > "$FAKE_DIR/load_reply"
  if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-bad.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >"$TMP_DIR/o-bad.log" 2>&1; then
    fail "start must reject id reply: $reply"
  else
    pass "start rejects id reply: $reply"
  fi
  if [[ -e "$TMP_DIR/r-bad.json" ]]; then fail "no receipt on rejected id: $reply"; else pass "no receipt on rejected id: $reply"; fi
  if grep -qF 'introspect' "$FAKE_DIR/calls.log" || grep -qF ' org.kde.kwin.Script run' "$FAKE_DIR/calls.log"; then
    fail "no object traffic on rejected id: $reply"
  else
    pass "no object traffic on rejected id: $reply"
  fi
  if grep -qF 'ambiguous loadScript identity' "$TMP_DIR/o-bad.log" && grep -qF 'preserving residue' "$TMP_DIR/o-bad.log"; then
    pass "malformed id emits ambiguity/preserved-residue: $reply"
  else
    fail "malformed id emits ambiguity/preserved-residue: $reply"
  fi
  if grep -qF 'unloadScript' "$FAKE_DIR/calls.log"; then
    fail "no guessed unload on unknown object: $reply"
  else
    pass "no guessed unload on unknown object: $reply"
  fi
  rm -f -- "$TMP_DIR/r-bad.json" "$TMP_DIR/o-bad.log"
done

# 6: run failure triggers partial cleanup of the exact id only.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RUN_EXIT=1; export FAKE_RUN_EXIT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-run.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 5 --delay 0.01 >/dev/null 2>&1; then
  fail "start must fail when run fails"
else
  pass "start fails when run fails"
fi
if [[ -e "$TMP_DIR/r-run.json" ]]; then fail "no receipt after run failure"; else pass "no receipt after run failure"; fi
if grep -qF "/Scripting/Script3 org.kde.kwin.Script stop" "$FAKE_DIR/calls.log" && grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log"; then
  pass "partial cleanup unloads only the exact id"
else
  fail "partial cleanup unloads only the exact id"
fi

# 7/8: wrong correlation and wrong owner in the result fail closed.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE2:$OWNER:$GENERATION:$REVISION:$NONCE2:could-execute:R2a:swap-neighbor"
export FAKE_RESULT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-corr.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject wrong correlation"
else
  pass "start rejects wrong correlation"
fi
if [[ -e "$TMP_DIR/r-corr.json" ]]; then fail "no receipt on correlation mismatch"; else pass "no receipt on correlation mismatch"; fi
if grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log"; then pass "correlation mismatch cleans the exact id"; else fail "correlation mismatch cleans the exact id"; fi
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:lost-owner:$GENERATION:$REVISION:$NONCE:could-execute:R2a:swap-neighbor"
export FAKE_RESULT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-owner.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject owner loss"
else
  pass "start rejects owner loss"
fi
if grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log"; then pass "owner loss cleans the exact id"; else fail "owner loss cleans the exact id"; fi

# 7b/7c: wrong generation/revision/nonce fail closed; unversioned prefix rejected.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:WRONG:$REVISION:$NONCE:could-execute:R2a:swap-neighbor"
export FAKE_RESULT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-gen.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject wrong generation"
else
  pass "start rejects wrong generation"
fi
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:999:$NONCE:could-execute:R2a:swap-neighbor"
export FAKE_RESULT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-rev.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject wrong revision"
else
  pass "start rejects wrong revision"
fi
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE2:could-execute:R2a:swap-neighbor"
export FAKE_RESULT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-nonce.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject wrong nonce"
else
  pass "start rejects wrong nonce"
fi
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute:R2a:swap-neighbor"
export FAKE_RESULT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-unver.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject an unversioned result"
else
  pass "start rejects an unversioned result"
fi

# 7d: mid-line prefix, empty detail, and oversize detail rejected.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="xx plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute:R2a:swap-neighbor"
export FAKE_RESULT
# Fake appends source/ready/result lines; prepend junk on the result line to force a mid-line match.
FAKE_APPEND=1; export FAKE_APPEND
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-mid.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject a mid-line prefix"
else
  pass "start rejects a mid-line prefix"
fi
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:"
export FAKE_RESULT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-empty.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject empty detail"
else
  pass "start rejects empty detail"
fi
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
BIG_DETAIL="$(printf 'a%.0s' $(seq 1 513))"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:$BIG_DETAIL"
export FAKE_RESULT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-big.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject oversize detail"
else
  pass "start rejects oversize detail"
fi

# 8: required after marker with invalid/mismatched rejection and drift fail-closed.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_AFTER=""; export FAKE_AFTER
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-noafter.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject a missing after marker"
else
  pass "start rejects a missing after marker"
fi
if [[ -e "$TMP_DIR/r-noafter.json" ]]; then fail "no receipt on missing after"; else pass "no receipt on missing after"; fi
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_AFTER="plasma-auto-tiler:advisory-describe-after:v1:$NONCE2:true"; export FAKE_AFTER
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-aftermismatch.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject a mismatched after marker"
else
  pass "start rejects a mismatched after marker"
fi
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_AFTER="plasma-auto-tiler:advisory-describe-after:v1:$NONCE:maybe"; export FAKE_AFTER
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-afterinvalid.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject an invalid after verdict"
else
  pass "start rejects an invalid after verdict"
fi
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="$RESULT"; FAKE_AFTER="$AFTER_FALSE"; export FAKE_RESULT FAKE_AFTER
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-drift-success.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject after drift with success detail"
else
  pass "start rejects after drift with success detail"
fi
if [[ -e "$TMP_DIR/r-drift-success.json" ]]; then fail "no receipt on drifted success"; else pass "no receipt on drifted success"; fi
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="$STALE_RESULT"; FAKE_AFTER="$AFTER_FALSE"; export FAKE_RESULT FAKE_AFTER
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-drift-stale.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse a receipt on stale refusal"
else
  pass "start refuses a receipt on stale refusal"
fi
if [[ -e "$TMP_DIR/r-drift-stale.json" ]]; then fail "no receipt on stale refusal"; else pass "no receipt on stale refusal"; fi
if grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log"; then pass "stale refusal cleans the exact id"; else fail "stale refusal cleans the exact id"; fi
if grep -qF 'reject:advisory-stale-snapshot' "$TMP_DIR/diag.log"; then pass "drift emits stale rejection"; else fail "drift emits stale rejection"; fi
rm -f -- "$TMP_DIR/r-drift-stale.json"
# 8b: only could-execute with after true receives a receipt; any other valid
# detail with after true is refused fail-closed.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:other-detail"; FAKE_AFTER="$AFTER"; export FAKE_RESULT FAKE_AFTER
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-other.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject a non-could-execute detail"
else
  pass "start rejects a non-could-execute detail"
fi
if [[ -e "$TMP_DIR/r-other.json" ]]; then fail "no receipt on other detail"; else pass "no receipt on other detail"; fi
if grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log"; then pass "other detail cleans the exact id"; else fail "other detail cleans the exact id"; fi
rm -f -- "$TMP_DIR/r-other.json"
# 8c: the after marker must follow the correlated result marker; a replayed
# earlier after marker cannot satisfy start.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="$RESULT"; FAKE_AFTER="$AFTER"; FAKE_ORDER="after-first"; export FAKE_RESULT FAKE_AFTER FAKE_ORDER
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-order.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject an after marker before the result"
else
  pass "start rejects an after marker before the result"
fi
if [[ -e "$TMP_DIR/r-order.json" ]]; then fail "no receipt on out-of-order after"; else pass "no receipt on out-of-order after"; fi
if grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log"; then pass "out-of-order after cleans the exact id"; else fail "out-of-order after cleans the exact id"; fi
rm -f -- "$TMP_DIR/r-order.json"

# 9: timeout with no markers fails closed with exact cleanup.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_APPEND=0; export FAKE_APPEND
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-timeout.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must time out without markers"
else
  pass "start times out without markers"
fi
if grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log" && [[ ! -e "$TMP_DIR/r-timeout.json" ]]; then
  pass "timeout cleans the exact id with no receipt"
else
  fail "timeout cleans the exact id with no receipt"
fi

# 9b: stale pre-run markers are ignored (post-run boundary only).
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
printf '%s\n%s\n%s\n%s\n' "$FAKE_SOURCE" "$READY" "$RESULT" "$AFTER" > "$TMP_DIR/diag.log"
FAKE_APPEND=0; export FAKE_APPEND
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-stale-mark.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must ignore stale pre-run markers"
else
  pass "start ignores stale pre-run markers"
fi
if grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log" && [[ ! -e "$TMP_DIR/r-stale-mark.json" ]]; then
  pass "stale markers clean the exact id with no receipt"
else
  fail "stale markers clean the exact id with no receipt"
fi

# 9c: missing or mismatched source marker fails closed.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_SOURCE="plasma-auto-tiler:advisory-describe-source:0000000000000000000000000000000000000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000"
export FAKE_SOURCE
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-srcbad.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject a mismatched source marker"
else
  pass "start rejects a mismatched source marker"
fi
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_SOURCE=""; export FAKE_SOURCE
FAKE_APPEND=1; export FAKE_APPEND
# Empty source line cannot equal the bound marker; loader must still fail.
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-srcmiss.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject a missing source marker"
else
  pass "start rejects a missing source marker"
fi

# 10: missing Script interface on the exact object fails closed.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
printf 'no interfaces here' > "$FAKE_DIR/introspect_reply"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-iface.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject a foreign object"
else
  pass "start rejects a foreign object"
fi
if grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log"; then pass "foreign object cleans the exact id"; else fail "foreign object cleans the exact id"; fi

# 11: the static advisory-only gate refuses a tainted bundle before any load.
# Note: workspace-text in the bundle is opaque data (sources are deny-scanned,
# the bundle only for ESM/imports), so this taint reaches verify after
# preflight but still allows no load/run and no receipt.
reset_fake; seed_diag
mkdir -p -- "$TMP_DIR/tainted"
cp -- "$BUNDLE" "$TMP_DIR/tainted/advisory-describe.js"
cp -- "$MANIFEST" "$TMP_DIR/tainted/advisory-describe.manifest.json"
printf '\nworkspace.managed = true;\n' >> "$TMP_DIR/tainted/advisory-describe.js"
TAINTED_SHA="$(sha256sum -- "$TMP_DIR/tainted/advisory-describe.js" | cut -d' ' -f1)"
node -e '
const fs = require("node:fs");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
m.bundleSha256 = process.argv[2];
fs.writeFileSync(process.argv[1], JSON.stringify(m) + "\n");
' "$TMP_DIR/tainted/advisory-describe.manifest.json" "$TAINTED_SHA"
if "$LOADER" start --bundle "$TMP_DIR/tainted/advisory-describe.js" --manifest "$TMP_DIR/tainted/advisory-describe.manifest.json" --receipt "$TMP_DIR/r-taint.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse a tainted bundle"
else
  pass "start refuses a tainted bundle"
fi
if grep -qF 'loadScript' "$FAKE_DIR/calls.log" 2>/dev/null || grep -qF ' org.kde.kwin.Script run' "$FAKE_DIR/calls.log" 2>/dev/null; then fail "no load/run after tainted refusal"; else pass "no load/run after tainted refusal"; fi
if [[ -e "$TMP_DIR/r-taint.json" ]]; then fail "no receipt on tainted bundle"; else pass "no receipt on tainted bundle"; fi

# 11a: truly static taint (ESM syntax in the bundle) fails before any bus
# transport and before verify: zero bus event plus zero verify.
reset_fake; seed_diag
mkdir -p -- "$TMP_DIR/tainted-static"
cp -- "$BUNDLE" "$TMP_DIR/tainted-static/advisory-describe.js"
cp -- "$MANIFEST" "$TMP_DIR/tainted-static/advisory-describe.manifest.json"
printf 'import x from "./y";\n' > "$TMP_DIR/tainted-static/advisory-describe.js.tmp"
cat -- "$BUNDLE" >> "$TMP_DIR/tainted-static/advisory-describe.js.tmp"
printf 'export const tainted = 1;\n' >> "$TMP_DIR/tainted-static/advisory-describe.js.tmp"
mv -- "$TMP_DIR/tainted-static/advisory-describe.js.tmp" "$TMP_DIR/tainted-static/advisory-describe.js"
TAINTED_STATIC_SHA="$(sha256sum -- "$TMP_DIR/tainted-static/advisory-describe.js" | cut -d' ' -f1)"
node -e '
const fs = require("node:fs");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
m.bundleSha256 = process.argv[2];
fs.writeFileSync(process.argv[1], JSON.stringify(m) + "\n");
' "$TMP_DIR/tainted-static/advisory-describe.manifest.json" "$TAINTED_STATIC_SHA"
if "$LOADER" start --bundle "$TMP_DIR/tainted-static/advisory-describe.js" --manifest "$TMP_DIR/tainted-static/advisory-describe.manifest.json" --receipt "$TMP_DIR/r-taint-static.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse a statically tainted bundle"
else
  pass "start refuses a statically tainted bundle"
fi
if [[ -s "$FAKE_DIR/calls.log" ]]; then fail "zero bus event on static taint"; else pass "zero bus event on static taint"; fi
if [[ -s "$FAKE_DIR/builder.log" ]]; then fail "zero verify on static taint"; else pass "zero verify on static taint"; fi
if [[ -f "$FAKE_DIR/events.log" ]] && [[ -s "$FAKE_DIR/events.log" ]]; then fail "zero shared events on static taint"; else pass "zero shared events on static taint"; fi
if [[ -e "$TMP_DIR/r-taint-static.json" ]]; then fail "no receipt on static taint"; else pass "no receipt on static taint"; fi

# 11b: source-valid manually altered bundle with recomputed sha refused by verify.
reset_fake; seed_diag
mkdir -p -- "$TMP_DIR/altered"
cp -- "$BUNDLE" "$TMP_DIR/altered/advisory-describe.js"
cp -- "$MANIFEST" "$TMP_DIR/altered/advisory-describe.manifest.json"
printf '\n// benign manual alteration\n' >> "$TMP_DIR/altered/advisory-describe.js"
ALTERED_SHA2="$(sha256sum -- "$TMP_DIR/altered/advisory-describe.js" | cut -d' ' -f1)"
node -e '
const fs = require("node:fs");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
m.bundleSha256 = process.argv[2];
fs.writeFileSync(process.argv[1], JSON.stringify(m) + "\n");
' "$TMP_DIR/altered/advisory-describe.manifest.json" "$ALTERED_SHA2"
if "$LOADER" start --bundle "$TMP_DIR/altered/advisory-describe.js" --manifest "$TMP_DIR/altered/advisory-describe.manifest.json" --receipt "$TMP_DIR/r-altered.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse a manually altered bundle"
else
  pass "start refuses a manually altered bundle"
fi
if grep -qF 'loadScript' "$FAKE_DIR/calls.log" || grep -qF ' org.kde.kwin.Script run' "$FAKE_DIR/calls.log"; then fail "no load/run on altered bundle"; else pass "no load/run on altered bundle"; fi
if grep -qF -- '--verify' "$FAKE_DIR/builder.log"; then pass "altered bundle reaches verify after preflight"; else fail "altered bundle reaches verify after preflight"; fi
if node "$BUILDER" --verify --input "$TMP_DIR/request.json" --bundle "$TMP_DIR/altered/advisory-describe.js" --manifest "$TMP_DIR/altered/advisory-describe.manifest.json" >/dev/null 2>&1; then
  fail "builder verify must reject the altered bundle"
else
  pass "builder verify rejects the altered bundle"
fi
if [[ ! -e "$BUNDLE" || ! -e "$MANIFEST" ]]; then fail "verify must not delete the fixed outputs"; else pass "verify leaves the fixed outputs alone"; fi

# 11c: valid input containing formerly denied data text does not block.
reset_fake
NONCE_D="$NONCE" OWNER_D="workspace.x" GENERATION_D="$GENERATION" REVISION_D="$REVISION" node -e '
const record = {
  nonce: process.env.NONCE_D,
  correlationId: process.env.NONCE_D,
  owner: process.env.OWNER_D,
  generation: process.env.GENERATION_D,
  revision: Number(process.env.REVISION_D),
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
require("node:fs").writeFileSync(process.argv[1], JSON.stringify(record));
' "$TMP_DIR/request-denied.json"
if node "$BUILDER" --input "$TMP_DIR/request-denied.json" --out "$BUNDLE" >/dev/null 2>&1; then
  pass "builder accepts denied-text data input"
else
  fail "builder accepts denied-text data input"
fi
cp -- "$TMP_DIR/request-denied.json" "$TMP_DIR/request-denied-saved.json"
READY_D="plasma-auto-tiler:advisory-describe-ready:$NONCE"
RESULT_D="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:workspace.x:$GENERATION:$REVISION:$NONCE:could-execute:R2a:swap-neighbor"
AFTER_D="plasma-auto-tiler:advisory-describe-after:v1:$NONCE:true"
ENTRY_SHA_D="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-describe-entry.ts" | cut -d' ' -f1)"
QUERY_SHA_D="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-plan-query.ts" | cut -d' ' -f1)"
SNAPSHOT_SHA_D="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-snapshot.ts" | cut -d' ' -f1)"
printf 'pre-run padding line\n' > "$TMP_DIR/diag.log"
FAKE_SOURCE="plasma-auto-tiler:advisory-describe-source:$ENTRY_SHA_D:$QUERY_SHA_D:$SNAPSHOT_SHA_D"
FAKE_READY="$READY_D"; FAKE_RESULT="$RESULT_D"; FAKE_AFTER="$AFTER_D"; FAKE_APPEND=1; FAKE_DIAG="$TMP_DIR/diag.log"
export FAKE_SOURCE FAKE_READY FAKE_RESULT FAKE_AFTER FAKE_APPEND FAKE_DIAG
queue_loaded "b false" "b false" "b false" "b true"
cp -- "$TMP_DIR/request-denied-saved.json" "$TMP_DIR/request.json"
if node "$BUILDER" --input "$TMP_DIR/request.json" --out "$BUNDLE" >/dev/null 2>&1; then pass "fixture rebuilt for denied-text"; else fail "fixture rebuilt for denied-text"; fi
seed_diag
FAKE_READY="$READY_D"; FAKE_RESULT="$RESULT_D"; FAKE_AFTER="$AFTER_D"; export FAKE_READY FAKE_RESULT FAKE_AFTER
ENTRY_SHA_D="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-describe-entry.ts" | cut -d' ' -f1)"
QUERY_SHA_D="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-plan-query.ts" | cut -d' ' -f1)"
SNAPSHOT_SHA_D="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-snapshot.ts" | cut -d' ' -f1)"
FAKE_SOURCE="plasma-auto-tiler:advisory-describe-source:$ENTRY_SHA_D:$QUERY_SHA_D:$SNAPSHOT_SHA_D"; export FAKE_SOURCE
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-denied.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 5 --delay 0.01 >/dev/null 2>&1; then
  pass "loader accepts denied-text data fixture"
else
  fail "loader accepts denied-text data fixture"
fi
# Restore the canonical fixture for the remaining tests.
NONCE="$NONCE" OWNER="$OWNER" GENERATION="$GENERATION" REVISION="$REVISION" node -e '
const record = {
  nonce: process.env.NONCE,
  correlationId: process.env.NONCE,
  owner: process.env.OWNER,
  generation: process.env.GENERATION,
  revision: Number(process.env.REVISION),
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
require("node:fs").writeFileSync(process.argv[1], JSON.stringify(record));
' "$TMP_DIR/request.json"
if node "$BUILDER" --input "$TMP_DIR/request.json" --out "$BUNDLE" >/dev/null 2>&1; then pass "canonical fixture restored"; else fail "canonical fixture restored"; fi

# 12: stale build identity (manifest sha no longer matching) refuses early.
reset_fake; seed_diag
mkdir -p -- "$TMP_DIR/stale"
cp -- "$BUNDLE" "$TMP_DIR/stale/advisory-describe.js"
cp -- "$MANIFEST" "$TMP_DIR/stale/advisory-describe.manifest.json"
sed -i 's/"bundleSha256":"[0-9a-f]\{64\}"/"bundleSha256":"0000000000000000000000000000000000000000000000000000000000000000"/' -- "$TMP_DIR/stale/advisory-describe.manifest.json"
if "$LOADER" start --bundle "$TMP_DIR/stale/advisory-describe.js" --manifest "$TMP_DIR/stale/advisory-describe.manifest.json" --receipt "$TMP_DIR/r-stale.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse stale build identity"
else
  pass "start refuses stale build identity"
fi
if [[ -s "$FAKE_DIR/calls.log" ]]; then fail "no bus traffic on stale identity"; else pass "no bus traffic on stale identity"; fi
if [[ -s "$FAKE_DIR/builder.log" ]]; then fail "no builder verify on stale identity"; else pass "no builder verify on stale identity"; fi

# 13: start refuses when a receipt is already recorded.
reset_fake; seed_diag
printf '{"schema":"advisory-describe-receipt-v1"}' > "$TMP_DIR/r-taken.json"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-taken.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse an existing receipt"
else
  pass "start refuses an existing receipt"
fi
if [[ -s "$FAKE_DIR/calls.log" ]]; then fail "no bus traffic on existing receipt"; else pass "no bus traffic on existing receipt"; fi
if [[ -s "$FAKE_DIR/builder.log" ]]; then fail "no builder verify on existing receipt"; else pass "no builder verify on existing receipt"; fi

# 13b: symlink receipt refused exclusively with no overwrite and no bus traffic.
reset_fake; seed_diag
printf 'sentinel' > "$TMP_DIR/receipt-target.json"
ln -sf -- "$TMP_DIR/receipt-target.json" "$TMP_DIR/r-link.json"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-link.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse a symlinked receipt"
else
  pass "start refuses a symlinked receipt"
fi
if [[ -L "$TMP_DIR/r-link.json" ]]; then pass "symlink receipt left unwritten"; else fail "symlink receipt was replaced"; fi
if [[ "$(cat -- "$TMP_DIR/receipt-target.json")" == "sentinel" ]]; then pass "symlink target untouched"; else fail "symlink target untouched"; fi
if [[ -s "$FAKE_DIR/calls.log" ]]; then fail "no bus traffic on symlinked receipt"; else pass "no bus traffic on symlinked receipt"; fi

# 13c: receipt parent must be a real non-symlink directory.
reset_fake; seed_diag
ln -sf -- "$TMP_DIR" "$TMP_DIR/parent-link"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/parent-link/r-parent.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse a symlinked receipt parent"
else
  pass "start refuses a symlinked receipt parent"
fi
if [[ -s "$FAKE_DIR/calls.log" ]]; then fail "no bus traffic on bad receipt parent"; else pass "no bus traffic on bad receipt parent"; fi
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/no-such-dir/r.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse a missing receipt parent"
else
  pass "start refuses a missing receipt parent"
fi

# 13d: start refuses when its exact plugin is already loaded (no loadScript).
reset_fake; seed_diag
printf 'b true' > "$FAKE_DIR/is_loaded_reply"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-already.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse an already-loaded plugin"
else
  pass "start refuses an already-loaded plugin"
fi
if grep -qF 'loadScript' "$FAKE_DIR/calls.log"; then fail "no loadScript when already loaded"; else pass "no loadScript when already loaded"; fi
if grep -qF 'unloadScript s plasma-auto-tiler-kwin' "$FAKE_DIR/calls.log"; then fail "production never mutated on already-loaded"; else pass "production never mutated on already-loaded"; fi
if [[ -e "$TMP_DIR/r-already.json" ]]; then fail "no receipt when already loaded"; else pass "no receipt when already loaded"; fi
if [[ -s "$FAKE_DIR/builder.log" ]]; then fail "no builder verify when already loaded"; else pass "no builder verify when already loaded"; fi

# 13e: host immutable preflight is resource-free until all checks pass.
# Each failure must show no builder verify, no load/run, no receipt, no
# resource creation in the guarded TMPDIR.
preflight_no_resources() {
  local label="$1" receipt="$2"
  if [[ -s "$FAKE_DIR/builder.log" ]]; then fail "no builder verify on $label"; else pass "no builder verify on $label"; fi
  if [[ -f "$FAKE_DIR/calls.log" ]] && { grep -qF 'loadScript' "$FAKE_DIR/calls.log" 2>/dev/null || grep -qF ' org.kde.kwin.Script run' "$FAKE_DIR/calls.log" 2>/dev/null; }; then
    fail "no load/run on $label"
  else
    pass "no load/run on $label"
  fi
  if [[ -e "$receipt" ]]; then fail "no receipt on $label"; else pass "no receipt on $label"; fi
  if [[ -d "$TMP_DIR/guard-tmp" ]] && [[ -n "$(ls -A -- "$TMP_DIR/guard-tmp" 2>/dev/null)" ]]; then
    fail "no guard-tmp resources on $label"
  else
    pass "no guard-tmp resources on $label"
  fi
  if [[ -f "$FAKE_DIR/events.log" ]] && grep -qF -- '--verify' "$FAKE_DIR/events.log" 2>/dev/null; then
    fail "no verify event on $label"
  else
    pass "no verify event on $label"
  fi
}

# Canonical executable unreadability / fallback failure (no unit).
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
rm -f -- "$FAKE_DIR/systemctl-show"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-pre-exe.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse unreadable executable fallback"
else
  pass "start refuses unreadable executable fallback"
fi
preflight_no_resources "unreadable executable fallback" "$TMP_DIR/r-pre-exe.json"

# Owner drift between preflight and recheck.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
printf ':1.10\n:1.11\n' > "$FAKE_DIR/owner-seq"
printf '4242\n4242\n' > "$FAKE_DIR/pid-seq"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-pre-owner.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse owner drift"
else
  pass "start refuses owner drift"
fi
preflight_no_resources "owner drift" "$TMP_DIR/r-pre-owner.json"

# PID drift between preflight and recheck.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
proc_fixture 4243 424300 "$FAKE_WRAPPED" 1
printf '4242\n4243\n' > "$FAKE_DIR/pid-seq"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-pre-pid.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse PID drift"
else
  pass "start refuses PID drift"
fi
preflight_no_resources "PID drift" "$TMP_DIR/r-pre-pid.json"

# Executable drift between preflight and recapture (same owner, different PID
# with a different executable identity must fail exact exe comparison).
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
mkdir -p -- "$TMP_DIR/fake-pkg-alt/bin"
printf 'alt-wrapped-fixture\n' > "$TMP_DIR/fake-pkg-alt/bin/.kwin_wayland_wrapper-wrapped"
chmod 555 -- "$TMP_DIR/fake-pkg-alt/bin/.kwin_wayland_wrapper-wrapped"
printf 'alt-launcher-fixture\n' > "$TMP_DIR/fake-pkg-alt/bin/kwin_wayland_wrapper"
chmod 555 -- "$TMP_DIR/fake-pkg-alt/bin/kwin_wayland_wrapper"
proc_fixture 4243 424300 "$TMP_DIR/fake-pkg-alt/bin/.kwin_wayland_wrapper-wrapped" 1
printf '4242\n4243\n' > "$FAKE_DIR/pid-seq"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-pre-exe-drift.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse executable drift"
else
  pass "start refuses executable drift"
fi
preflight_no_resources "executable drift" "$TMP_DIR/r-pre-exe-drift.json"

# Fallback mismatch: MainPID mismatch without a valid direct-parent topology.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
write_systemctl_show "$FAKE_LAUNCHER" "9999"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-pre-fallback.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse fallback mismatch"
else
  pass "start refuses fallback mismatch"
fi
preflight_no_resources "fallback mismatch" "$TMP_DIR/r-pre-fallback.json"
# Exact MainPID mismatch must attempt direct-parent (2 systemctl calls for the
# first failed capture), proving the status gate is reached.
if [[ -f "$FAKE_DIR/systemctl.log" ]] && [[ "$(wc -l < "$FAKE_DIR/systemctl.log" | tr -d ' ')" == "2" ]]; then
  pass "exact mismatch reaches direct-parent"
else
  fail "exact mismatch reaches direct-parent"
fi

# Status-gate proof at the helper boundary: only the exact valid parsed
# MainPID-not-equal-owner case returns the fixed status; any other helper
# failure returns a different status.
HELPER_UNDER_TEST="$REPO_ROOT/scripts/poc3-host-kwin-identity.sh"
helper_status_for_mainpid() {
  local fake_mainpid="$1"
  write_systemctl_show "$FAKE_LAUNCHER" "$fake_mainpid"
  set +e
  SYSTEMCTL_BIN="$FAKE_BIN/systemctl" PROC_ROOT="$FAKE_PROC" \
    POC3_KWIN_IDENTITY_TEST_ALLOW_NONPROC=1 POC3_KWIN_IDENTITY_TEST_ALLOW_NONSTORE=1 \
    bash -c '. "$1"; poc3_kwin_systemd_fallback "$2" "$3" "$4"' _ "$HELPER_UNDER_TEST" ":1.10" "4242" "424200" >/dev/null 2>&1
  printf '%s' "$?"
  set -e
}
if [[ "$(helper_status_for_mainpid 9999)" == "42" ]]; then
  pass "helper returns the fixed status for the exact mismatch"
else
  fail "helper returns the fixed status for the exact mismatch"
fi
if [[ "$(helper_status_for_mainpid 0)" != "42" ]]; then
  pass "helper does not return the fixed status for malformed MainPID"
else
  fail "helper does not return the fixed status for malformed MainPID"
fi
# Non-MainPID failure must not reach direct-parent: valid direct-parent
# topology but missing unit (ordinary fails with unit unavailable, not the
# fixed mismatch status) must show exactly 1 systemctl call.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
rm -rf -- "$FAKE_PROC/4242" "$FAKE_PROC/4243"
proc_fixture 4242 424100 "$FAKE_WRAPPED" 1
proc_fixture 4243 424200 "$FAKE_WRAPPED" 4242
printf ':1.10\n' > "$FAKE_DIR/kwin-owner"
printf '4243\n' > "$FAKE_DIR/kwin-pid"
rm -f -- "$FAKE_DIR/systemctl-show"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-pre-nonmatch.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse non-mismatch fallback failure"
else
  pass "start refuses non-mismatch fallback failure"
fi
preflight_no_resources "non-mismatch fallback failure" "$TMP_DIR/r-pre-nonmatch.json"
if [[ -f "$FAKE_DIR/systemctl.log" ]] && [[ "$(wc -l < "$FAKE_DIR/systemctl.log" | tr -d ' ')" == "1" ]]; then
  pass "non-mismatch status does not reach direct-parent"
else
  fail "non-mismatch status does not reach direct-parent"
fi

# Production absent (must be loaded).
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
printf 'b false' > "$FAKE_DIR/prod_reply"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-pre-prod.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse absent production"
else
  pass "start refuses absent production"
fi
preflight_no_resources "absent production" "$TMP_DIR/r-pre-prod.json"

# Planner collision (must be absent).
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
printf ':1.99\n' > "$FAKE_DIR/planner-owner"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-pre-planner.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse planner collision"
else
  pass "start refuses planner collision"
fi
preflight_no_resources "planner collision" "$TMP_DIR/r-pre-planner.json"

# Planner transport failure must fail closed with no verify/load/run/receipt.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
: > "$FAKE_DIR/planner-fail"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-pre-planner-transport.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse planner transport failure"
else
  pass "start refuses planner transport failure"
fi
preflight_no_resources "planner transport failure" "$TMP_DIR/r-pre-planner-transport.json"

# Planner malformed boolean/reply must fail closed with no verify/load/run.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
printf 'garbage' > "$FAKE_DIR/bad-planner-reply"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-pre-planner-malformed.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse malformed planner boolean"
else
  pass "start refuses malformed planner boolean"
fi
preflight_no_resources "malformed planner boolean" "$TMP_DIR/r-pre-planner-malformed.json"
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
printf '{"type":"s","data":["x"]}' > "$FAKE_DIR/bad-planner-reply"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-pre-planner-malformed2.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse malformed planner reply type"
else
  pass "start refuses malformed planner reply type"
fi
preflight_no_resources "malformed planner reply type" "$TMP_DIR/r-pre-planner-malformed2.json"

# Malformed KWin owner output.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
printf 'garbage' > "$FAKE_DIR/bad-owner-reply"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-pre-badowner.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse malformed owner output"
else
  pass "start refuses malformed owner output"
fi
preflight_no_resources "malformed owner" "$TMP_DIR/r-pre-badowner.json"

# Malformed KWin PID output.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
printf '{"type":"u","data":[]}' > "$FAKE_DIR/bad-pid-reply"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-pre-badpid.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse malformed PID output"
else
  pass "start refuses malformed PID output"
fi
preflight_no_resources "malformed PID" "$TMP_DIR/r-pre-badpid.json"

# Tool mismatch: missing systemctl tool fails closed before verify.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
if SYSTEMCTL_BIN="/nonexistent-systemctl" "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-pre-tool.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse a missing tool"
else
  pass "start refuses a missing tool"
fi
preflight_no_resources "tool mismatch" "$TMP_DIR/r-pre-tool.json"

# 13f: approved direct-parent fallback success with production loaded and
# absence checks before verify then lifecycle.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
rm -rf -- "$FAKE_PROC/4242" "$FAKE_PROC/4243"
proc_fixture 4242 424100 "$FAKE_WRAPPED" 1
proc_fixture 4243 424200 "$FAKE_WRAPPED" 4242
printf ':1.10\n' > "$FAKE_DIR/kwin-owner"
printf '4243\n' > "$FAKE_DIR/kwin-pid"
write_systemctl_show "$FAKE_LAUNCHER" "4242"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-direct.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 5 --delay 0.01 >/dev/null 2>&1; then
  pass "start accepts approved direct-parent fallback"
else
  fail "start accepts approved direct-parent fallback"
fi
if grep -qF '"scriptId":3' "$TMP_DIR/r-direct.json"; then pass "direct-parent receipt records the exact id"; else fail "direct-parent receipt records the exact id"; fi
if grep -qF -- '--verify' "$FAKE_DIR/builder.log" && grep -qF 'loadScript ss' "$FAKE_DIR/calls.log" && grep -qF ' org.kde.kwin.Script run' "$FAKE_DIR/calls.log"; then
  pass "direct-parent runs verify before lifecycle"
else
  fail "direct-parent runs verify before lifecycle"
fi
if grep -qF 'isScriptLoaded s plasma-auto-tiler-kwin' "$FAKE_DIR/calls.log" && grep -qF 'GetNameOwner' "$FAKE_DIR/calls.log"; then
  pass "direct-parent proves production plus absence before verify"
else
  fail "direct-parent proves production plus absence before verify"
fi
assert_event_order "direct-parent-success"
rm -f -- "$TMP_DIR/r-direct.json"

# 13f-ii: near-miss PPid (owner parent off by one level) fails closed with no
# resources, even though the exact mismatch status routes to direct-parent.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
rm -rf -- "$FAKE_PROC/4242" "$FAKE_PROC/4243"
proc_fixture 4242 424100 "$FAKE_WRAPPED" 1
proc_fixture 4243 424200 "$FAKE_WRAPPED" 9999
printf ':1.10\n' > "$FAKE_DIR/kwin-owner"
printf '4243\n' > "$FAKE_DIR/kwin-pid"
write_systemctl_show "$FAKE_LAUNCHER" "4242"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-nearmiss.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse near-miss PPid"
else
  pass "start refuses near-miss PPid"
fi
preflight_no_resources "near-miss PPid" "$TMP_DIR/r-nearmiss.json"
if [[ -f "$FAKE_DIR/systemctl.log" ]] && [[ "$(wc -l < "$FAKE_DIR/systemctl.log" | tr -d ' ')" == "2" ]]; then
  pass "near-miss still routes via the mismatch status then refuses"
else
  fail "near-miss still routes via the mismatch status then refuses"
fi

# 13f-iii: readable owner exe mismatch fails closed with no resources.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
rm -rf -- "$FAKE_PROC/4242" "$FAKE_PROC/4243"
proc_fixture 4242 424100 "$FAKE_WRAPPED" 1
proc_fixture 4243 424200 "$FAKE_WRAPPED" 4242
printf ':1.10\n' > "$FAKE_DIR/kwin-owner"
printf '4243\n' > "$FAKE_DIR/kwin-pid"
write_systemctl_show "$FAKE_LAUNCHER" "4242"
printf 'foreign-exe-fixture\n' > "$TMP_DIR/foreign-exe"
chmod 555 -- "$TMP_DIR/foreign-exe"
rm -f -- "$FAKE_PROC/4243/exe"
ln -s -- "$TMP_DIR/foreign-exe" "$FAKE_PROC/4243/exe"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-exemismatch.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse readable exe mismatch"
else
  pass "start refuses readable exe mismatch"
fi
preflight_no_resources "readable exe mismatch" "$TMP_DIR/r-exemismatch.json"

# 14: stop and status fail closed on stale/malformed receipts with no bus calls.
reset_fake
printf '{"schema":"advisory-describe-receipt-v1","plugin":"plasma-auto-tiler-advisory-describe","scriptId":99999999999,"scriptObject":"/Scripting/Script99999999999","bundleSha256":"%s","entrySha256":"%s","querySha256":"%s","owner":"%s","generation":"%s","revision":%s,"correlationId":"%s","nonce":"%s"}\n' \
  "$(sha256sum -- "$BUNDLE" | cut -d' ' -f1)" "$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-describe-entry.ts" | cut -d' ' -f1)" \
  "$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-plan-query.ts" | cut -d' ' -f1)" "$OWNER" "$GENERATION" "$REVISION" "$NONCE" "$NONCE" > "$TMP_DIR/r-range.json"
if "$LOADER" stop --receipt "$TMP_DIR/r-range.json" >/dev/null 2>&1; then fail "stop must refuse an out-of-range receipt id"; else pass "stop refuses an out-of-range receipt id"; fi
if [[ -s "$FAKE_DIR/calls.log" ]]; then fail "no bus traffic on out-of-range receipt"; else pass "no bus traffic on out-of-range receipt"; fi
printf '{"schema":"wrong-schema","plugin":"plasma-auto-tiler-advisory-describe"}' > "$TMP_DIR/r-schema.json"
if "$LOADER" status --receipt "$TMP_DIR/r-schema.json" >/dev/null 2>&1; then fail "status must refuse a schema mismatch"; else pass "status refuses a schema mismatch"; fi
if [[ -s "$FAKE_DIR/calls.log" ]]; then fail "no bus traffic on schema mismatch"; else pass "no bus traffic on schema mismatch"; fi
printf '{"schema":"advisory-describe-receipt-v1","plugin":"other-plugin","scriptId":3,"scriptObject":"/Scripting/Script3","bundleSha256":"%s","entrySha256":"%s","querySha256":"%s","owner":"%s","generation":"%s","revision":%s,"correlationId":"%s","nonce":"%s"}\n' \
  "$(sha256sum -- "$BUNDLE" | cut -d' ' -f1)" "$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-describe-entry.ts" | cut -d' ' -f1)" \
  "$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-plan-query.ts" | cut -d' ' -f1)" "$OWNER" "$GENERATION" "$REVISION" "$NONCE" "$NONCE" > "$TMP_DIR/r-plugin.json"
if "$LOADER" stop --receipt "$TMP_DIR/r-plugin.json" >/dev/null 2>&1; then fail "stop must refuse a foreign plugin receipt"; else pass "stop refuses a foreign plugin receipt"; fi
if [[ -s "$FAKE_DIR/calls.log" ]]; then fail "no bus traffic on foreign plugin receipt"; else pass "no bus traffic on foreign plugin receipt"; fi

# 15: diagnostics rejects a result bound to the wrong nonce.
reset_fake; seed_diag
cp -- "$TMP_DIR/r0.json" "$TMP_DIR/r-diag.json"
ENTRY_SHA_T="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-describe-entry.ts" | cut -d' ' -f1)"
QUERY_SHA_T="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-plan-query.ts" | cut -d' ' -f1)"
SNAPSHOT_SHA_T="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-snapshot.ts" | cut -d' ' -f1)"
SOURCE_T="plasma-auto-tiler:advisory-describe-source:$ENTRY_SHA_T:$QUERY_SHA_T:$SNAPSHOT_SHA_T"
printf '%s\n%s\n%s\n%s\n' "$READY" "$SOURCE_T" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE2:could-execute:R2a:swap-neighbor" "$AFTER" > "$TMP_DIR/diag-bad-nonce.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-bad-nonce.log" >/dev/null 2>&1; then
  fail "diagnostics must reject a wrong-nonce result"
else
  pass "diagnostics rejects a wrong-nonce result"
fi
# Diagnostics applies the same versioned anchored rules: mid-line, empty,
# oversize, wrong generation/revision, and missing source all fail.
printf '%s\n%s\n%s\n%s\n' "$READY" "$SOURCE_T" "xx plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute:R2a:swap-neighbor" "$AFTER" > "$TMP_DIR/diag-mid.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-mid.log" >/dev/null 2>&1; then
  fail "diagnostics must reject a mid-line prefix"
else
  pass "diagnostics rejects a mid-line prefix"
fi
printf '%s\n%s\n%s\n%s\n' "$READY" "$SOURCE_T" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:" "$AFTER" > "$TMP_DIR/diag-empty.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-empty.log" >/dev/null 2>&1; then
  fail "diagnostics must reject empty detail"
else
  pass "diagnostics rejects empty detail"
fi
BIG_D="$(printf 'b%.0s' $(seq 1 513))"
printf '%s\n%s\n%s\n%s\n' "$READY" "$SOURCE_T" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:$BIG_D" "$AFTER" > "$TMP_DIR/diag-big.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-big.log" >/dev/null 2>&1; then
  fail "diagnostics must reject oversize detail"
else
  pass "diagnostics rejects oversize detail"
fi
printf '%s\n%s\n%s\n%s\n' "$READY" "$SOURCE_T" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:WRONG:$REVISION:$NONCE:could-execute:R2a:swap-neighbor" "$AFTER" > "$TMP_DIR/diag-gen.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-gen.log" >/dev/null 2>&1; then
  fail "diagnostics must reject wrong generation"
else
  pass "diagnostics rejects wrong generation"
fi
printf '%s\n%s\n%s\n%s\n' "$READY" "$SOURCE_T" "plasma-auto-tiler:advisory-describe-result:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute:R2a:swap-neighbor" "$AFTER" > "$TMP_DIR/diag-unver.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-unver.log" >/dev/null 2>&1; then
  fail "diagnostics must reject an unversioned result"
else
  pass "diagnostics rejects an unversioned result"
fi
printf '%s\n%s\n%s\n' "$READY" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute:R2a:swap-neighbor" "$AFTER" > "$TMP_DIR/diag-nosrc.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-nosrc.log" >/dev/null 2>&1; then
  fail "diagnostics must reject a missing source marker"
else
  pass "diagnostics rejects a missing source marker"
fi
# 15-after: diagnostics requires a bounded opaque correlated after verdict.
printf '%s\n%s\n%s\n' "$READY" "$SOURCE_T" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute:R2a:swap-neighbor" > "$TMP_DIR/diag-noafter.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-noafter.log" >/dev/null 2>&1; then
  fail "diagnostics must reject a missing after marker"
else
  pass "diagnostics rejects a missing after marker"
fi
printf '%s\n%s\n%s\n%s\n' "$READY" "$SOURCE_T" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute:R2a:swap-neighbor" "plasma-auto-tiler:advisory-describe-after:v1:$NONCE2:true" > "$TMP_DIR/diag-after-mismatch.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-after-mismatch.log" >/dev/null 2>&1; then
  fail "diagnostics must reject a mismatched after marker"
else
  pass "diagnostics rejects a mismatched after marker"
fi
printf '%s\n%s\n%s\n%s\n' "$READY" "$SOURCE_T" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute:R2a:swap-neighbor" "plasma-auto-tiler:advisory-describe-after:v1:$NONCE:maybe" > "$TMP_DIR/diag-after-invalid.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-after-invalid.log" >/dev/null 2>&1; then
  fail "diagnostics must reject an invalid after verdict"
else
  pass "diagnostics rejects an invalid after verdict"
fi
printf '%s\n%s\n%s\n%s\n' "$READY" "$SOURCE_T" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute:R2a:swap-neighbor" "xx plasma-auto-tiler:advisory-describe-after:v1:$NONCE:true" > "$TMP_DIR/diag-after-mid.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-after-mid.log" >/dev/null 2>&1; then
  fail "diagnostics must reject a mid-line after prefix"
else
  pass "diagnostics rejects a mid-line after prefix"
fi
printf '%s\n%s\n%s\n%s\n' "$READY" "$SOURCE_T" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute:R2a:swap-neighbor" "$AFTER_FALSE" > "$TMP_DIR/diag-after-false-success.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-after-false-success.log" >/dev/null 2>&1; then
  fail "diagnostics must reject after false with success detail"
else
  pass "diagnostics rejects after false with success detail"
fi
printf '%s\n%s\n%s\n%s\n' "$READY" "$SOURCE_T" "$STALE_RESULT" "$AFTER_FALSE" > "$TMP_DIR/diag-after-false-stale.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-after-false-stale.log" >/dev/null 2>&1; then
  pass "diagnostics accepts after false with stale rejection"
else
  fail "diagnostics accepts after false with stale rejection"
fi
printf '%s\n%s\n%s\n%s\n' "$READY" "$SOURCE_T" "$AFTER" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute:R2a:swap-neighbor" > "$TMP_DIR/diag-after-first.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-after-first.log" >/dev/null 2>&1; then
  fail "diagnostics must reject an after marker before the result"
else
  pass "diagnostics rejects an after marker before the result"
fi
# 15a: diagnostics validates only the bounded 64KiB tail.
{
  printf '%s\n%s\n%s\n%s\n' "$READY" "$SOURCE_T" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute:R2a:swap-neighbor" "$AFTER"
  head -c 70000 /dev/zero | tr '\0' 'p'; printf '\n'
} > "$TMP_DIR/diag-old-tail.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-old-tail.log" >/dev/null 2>&1; then
  fail "diagnostics must ignore valid markers outside the bounded tail"
else
  pass "diagnostics ignores valid markers outside the bounded tail"
fi
{
  head -c 70000 /dev/zero | tr '\0' 'p'; printf '\n'
  printf '%s\n%s\n%s\n%s\n' "$READY" "$SOURCE_T" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute:R2a:swap-neighbor" "$AFTER"
} > "$TMP_DIR/diag-current-tail.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-current-tail.log" >/dev/null 2>&1; then
  pass "diagnostics accepts a correlated current marker tail"
else
  fail "diagnostics accepts a correlated current marker tail"
fi

# 15b: multiline and duplicate-key manifest/receipt rejected with no bus traffic.
reset_fake; seed_diag
cp -- "$MANIFEST" "$TMP_DIR/manifest-multi.json"
printf '\n{"extra":1}\n' >> "$TMP_DIR/manifest-multi.json"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$TMP_DIR/manifest-multi.json" --receipt "$TMP_DIR/r-multi.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject a multiline manifest"
else
  pass "start rejects a multiline manifest"
fi
if [[ -s "$FAKE_DIR/calls.log" ]]; then fail "no bus traffic on multiline manifest"; else pass "no bus traffic on multiline manifest"; fi
cp -- "$MANIFEST" "$TMP_DIR/manifest-dup.json"
node -e '
const fs = require("node:fs");
let t = fs.readFileSync(process.argv[1], "utf8").trimEnd();
t = t.slice(0, -1) + ",\"nonce\":\"00000000000000000000000000000000\"}";
fs.writeFileSync(process.argv[1], t + "\n");
' "$TMP_DIR/manifest-dup.json"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$TMP_DIR/manifest-dup.json" --receipt "$TMP_DIR/r-dup.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject a duplicate-key manifest"
else
  pass "start rejects a duplicate-key manifest"
fi
cp -- "$TMP_DIR/r0.json" "$TMP_DIR/r-dup2.json"
node -e '
const fs = require("node:fs");
let t = fs.readFileSync(process.argv[1], "utf8").trimEnd();
t = t.slice(0, -1) + ",\"plugin\":\"advisory-describe\"}";
fs.writeFileSync(process.argv[1], t + "\n");
' "$TMP_DIR/r-dup2.json"
if "$LOADER" status --receipt "$TMP_DIR/r-dup2.json" >/dev/null 2>&1; then
  fail "status must reject a duplicate-key receipt"
else
  pass "status rejects a duplicate-key receipt"
fi
if [[ -s "$FAKE_DIR/calls.log" ]]; then fail "no bus traffic on duplicate receipt"; else pass "no bus traffic on duplicate receipt"; fi

# 16: argument strictness fails before any transport.
reset_fake; seed_diag
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-arg.json" --diag-file "$TMP_DIR/diag.log" >/dev/null 2>&1; then fail "start must require --input"; else pass "start requires --input"; fi
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-arg.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --input "$TMP_DIR/request.json" >/dev/null 2>&1; then fail "start must reject duplicate --input"; else pass "start rejects duplicate --input"; fi
if "$LOADER" start --bundle "$BUNDLE" --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-arg.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" >/dev/null 2>&1; then fail "start must reject duplicate flags"; else pass "start rejects duplicate flags"; fi
if "$LOADER" bogus --receipt "$TMP_DIR/r0.json" >/dev/null 2>&1; then fail "loader must reject unknown commands"; else pass "loader rejects unknown commands"; fi
if [[ -s "$FAKE_DIR/calls.log" ]]; then fail "no bus traffic on argument refusal"; else pass "no bus traffic on argument refusal"; fi
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-arg2.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --expected-planner-owner ":1.99" --expected-planner-owner ":1.99" >/dev/null 2>&1; then fail "start must reject duplicate expected owner"; else pass "start rejects duplicate expected owner"; fi
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-arg2.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --expected-planner-owner "not-unique" >/dev/null 2>&1; then fail "start must reject malformed expected owner"; else pass "start rejects malformed expected owner"; fi
if "$LOADER" preflight --bundle "$BUNDLE" --manifest "$MANIFEST" >/dev/null 2>&1; then fail "preflight must require --input"; else pass "preflight requires --input"; fi
if "$LOADER" preflight --bundle "$BUNDLE" --manifest "$MANIFEST" --input "$TMP_DIR/request.json" --input "$TMP_DIR/request.json" >/dev/null 2>&1; then fail "preflight must reject duplicate --input"; else pass "preflight rejects duplicate --input"; fi

# 17: strict preflight subcommand is resource-free and emits only safe
# machine-independent manifest identity.
preflight_cmd_no_resources() {
  local label="$1"
  if [[ -s "$FAKE_DIR/builder.log" ]]; then fail "no builder verify on preflight $label"; else pass "no builder verify on preflight $label"; fi
  if [[ -f "$FAKE_DIR/calls.log" ]] && { grep -qF 'loadScript' "$FAKE_DIR/calls.log" 2>/dev/null || grep -qF ' org.kde.kwin.Script run' "$FAKE_DIR/calls.log" 2>/dev/null; }; then
    fail "no load/run on preflight $label"
  else
    pass "no load/run on preflight $label"
  fi
  if [[ -f "$FAKE_DIR/events.log" ]] && grep -qF -- '--verify' "$FAKE_DIR/events.log" 2>/dev/null; then
    fail "no verify event on preflight $label"
  else
    pass "no verify event on preflight $label"
  fi
  if [[ -d "$TMP_DIR/guard-tmp" ]] && [[ -n "$(ls -A -- "$TMP_DIR/guard-tmp" 2>/dev/null)" ]]; then
    fail "no guard-tmp resources on preflight $label"
  else
    pass "no guard-tmp resources on preflight $label"
  fi
}
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
if "$LOADER" preflight --bundle "$BUNDLE" --manifest "$MANIFEST" --input "$TMP_DIR/request.json" > "$TMP_DIR/o-preflight" 2>&1; then
  pass "preflight accepts absent default"
else
  fail "preflight accepts absent default"
fi
if grep -qF 'preflight: bundle=' "$TMP_DIR/o-preflight" && grep -qF "owner=$OWNER" "$TMP_DIR/o-preflight" && grep -qF "correlation=$NONCE" "$TMP_DIR/o-preflight"; then
  pass "preflight emits safe manifest identity"
else
  fail "preflight emits safe manifest identity"
fi
for _secret in ":1.10" "4242" "424200" "kwin_wayland" ":1.99"; do
  if grep -qF -- "$_secret" "$TMP_DIR/o-preflight"; then fail "preflight hides machine detail $_secret"; else pass "preflight hides machine detail $_secret"; fi
done
if grep -qF 'NameHasOwner' "$FAKE_DIR/calls.log" && grep -qF 'GetNameOwner' "$FAKE_DIR/calls.log" && grep -qF 'GetConnectionUnixProcessID' "$FAKE_DIR/calls.log"; then
  pass "preflight proves source/tool/KWin/prod/advisory/planner-absence"
else
  fail "preflight proves source/tool/KWin/prod/advisory/planner-absence"
fi
preflight_cmd_no_resources "absent-success"
# Preflight collision by default (planner present without explicit owner).
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
printf ':1.99\n' > "$FAKE_DIR/planner-owner"
if "$LOADER" preflight --bundle "$BUNDLE" --manifest "$MANIFEST" --input "$TMP_DIR/request.json" >/dev/null 2>&1; then
  fail "preflight must refuse planner collision by default"
else
  pass "preflight refuses planner collision by default"
fi
preflight_cmd_no_resources "collision"
# Preflight with explicit expected owner succeeds when present.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
setup_planner_present ":1.99" 4343 434300
if "$LOADER" preflight --bundle "$BUNDLE" --manifest "$MANIFEST" --input "$TMP_DIR/request.json" --expected-planner-owner ":1.99" > "$TMP_DIR/o-preflight-exp" 2>&1; then
  pass "preflight accepts expected present owner"
else
  fail "preflight accepts expected present owner"
fi
if grep -qF 'GetNameOwner' "$FAKE_DIR/calls.log" && grep -qF 'GetConnectionUnixProcessID' "$FAKE_DIR/calls.log"; then
  pass "preflight proves exact present owner"
else
  fail "preflight proves exact present owner"
fi
preflight_cmd_no_resources "expected-success"
# Preflight expected owner absent/mismatch/malformed refuses resource-free.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
if "$LOADER" preflight --bundle "$BUNDLE" --manifest "$MANIFEST" --input "$TMP_DIR/request.json" --expected-planner-owner ":1.99" >/dev/null 2>&1; then
  fail "preflight must refuse absent expected owner"
else
  pass "preflight refuses absent expected owner"
fi
preflight_cmd_no_resources "absent-expected"
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
setup_planner_present ":1.77" 4343 434300
if "$LOADER" preflight --bundle "$BUNDLE" --manifest "$MANIFEST" --input "$TMP_DIR/request.json" --expected-planner-owner ":1.99" >/dev/null 2>&1; then
  fail "preflight must refuse owner mismatch"
else
  pass "preflight refuses owner mismatch"
fi
preflight_cmd_no_resources "mismatch"
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
setup_planner_present ":1.99" 4343 434300
printf 'garbage' > "$FAKE_DIR/bad-planner-owner-reply"
if "$LOADER" preflight --bundle "$BUNDLE" --manifest "$MANIFEST" --input "$TMP_DIR/request.json" --expected-planner-owner ":1.99" >/dev/null 2>&1; then
  fail "preflight must refuse malformed present owner"
else
  pass "preflight refuses malformed present owner"
fi
preflight_cmd_no_resources "malformed-owner"

# 18: start with exact expected Planner unique owner skips only absence.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
setup_planner_present ":1.99" 4343 434300
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-exp.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 5 --delay 0.01 --expected-planner-owner ":1.99" > "$TMP_DIR/o-exp" 2>&1; then
  pass "start accepts expected present owner"
else
  fail "start accepts expected present owner"
fi
if grep -qF '"scriptId":3' "$TMP_DIR/r-exp.json" && grep -qF 'planner-owner=:1.99' "$TMP_DIR/o-exp"; then
  pass "expected-owner start records exact id and proves planner owner"
else
  fail "expected-owner start records exact id and proves planner owner"
fi
if grep -qF 'GetNameOwner s org.plasmaautotiler.Planner' "$FAKE_DIR/calls.log" && grep -qF 'GetConnectionUnixProcessID s :1.99' "$FAKE_DIR/calls.log"; then
  pass "expected-owner start proves exact present owner before and after"
else
  fail "expected-owner start proves exact present owner before and after"
fi
if grep -qF -- '--verify' "$FAKE_DIR/builder.log" && grep -qF 'loadScript ss' "$FAKE_DIR/calls.log"; then
  pass "expected-owner start runs verify before lifecycle"
else
  fail "expected-owner start runs verify before lifecycle"
fi
rm -f -- "$TMP_DIR/r-exp.json"
# Default still requires absence even with a valid planner present.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
setup_planner_present ":1.99" 4343 434300
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-exp-default.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "default start must still refuse planner collision"
else
  pass "default start still refuses planner collision"
fi
preflight_no_resources "default-collision-with-planner-present" "$TMP_DIR/r-exp-default.json"
rm -f -- "$TMP_DIR/r-exp-default.json"
# Expected mismatch refuses with exact cleanup and no receipt.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
setup_planner_present ":1.77" 4343 434300
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-exp-mismatch.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 --expected-planner-owner ":1.99" >/dev/null 2>&1; then
  fail "expected-owner start must refuse mismatch"
else
  pass "expected-owner start refuses mismatch"
fi
if [[ -e "$TMP_DIR/r-exp-mismatch.json" ]]; then fail "no receipt on planner mismatch"; else pass "no receipt on planner mismatch"; fi
if grep -qF 'loadScript' "$FAKE_DIR/calls.log" 2>/dev/null || grep -qF ' org.kde.kwin.Script run' "$FAKE_DIR/calls.log" 2>/dev/null; then fail "no load/run on planner mismatch"; else pass "no load/run on planner mismatch"; fi
# Post-lifecycle drift: two pre proofs stable, after proof drifts.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
setup_planner_present ":1.99" 4343 434300
printf ':1.99\n:1.99\n:1.77\n' > "$FAKE_DIR/planner-owner-seq"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-exp-drift.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 5 --delay 0.01 --expected-planner-owner ":1.99" >/dev/null 2>&1; then
  fail "expected-owner start must refuse post-lifecycle drift"
else
  pass "expected-owner start refuses post-lifecycle drift"
fi
if [[ -e "$TMP_DIR/r-exp-drift.json" ]]; then fail "no receipt on planner drift"; else pass "no receipt on planner drift"; fi
if grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log"; then pass "planner drift cleans the exact id"; else fail "planner drift cleans the exact id"; fi
rm -f -- "$TMP_DIR/r-exp-drift.json"
# PID drift with stable owner between the two pre-lifecycle proofs: exact
# triple comparison must fail closed before verify/load/run with no receipt.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
setup_planner_present ":1.99" 4343 434300
proc_fixture 4344 434400 "$FAKE_WRAPPED" 1
printf '4343\n4344\n' > "$FAKE_DIR/planner-pid-seq"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-exp-pid-pre.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 --expected-planner-owner ":1.99" >/dev/null 2>&1; then
  fail "expected-owner start must refuse pre-lifecycle PID drift with stable owner"
else
  pass "expected-owner start refuses pre-lifecycle PID drift with stable owner"
fi
if [[ -e "$TMP_DIR/r-exp-pid-pre.json" ]]; then fail "no receipt on pre-lifecycle PID drift"; else pass "no receipt on pre-lifecycle PID drift"; fi
preflight_no_resources "pre-lifecycle-planner-pid-drift" "$TMP_DIR/r-exp-pid-pre.json"
rm -f -- "$TMP_DIR/r-exp-pid-pre.json"
# PID drift with stable owner after lifecycle: two pre proofs stable, post
# proof drifts PID while owner stays exact. Must refuse with no receipt and
# clean the exact id.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
setup_planner_present ":1.99" 4343 434300
proc_fixture 4344 434400 "$FAKE_WRAPPED" 1
printf '4343\n4343\n4344\n' > "$FAKE_DIR/planner-pid-seq"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-exp-pid-drift.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 5 --delay 0.01 --expected-planner-owner ":1.99" >/dev/null 2>&1; then
  fail "expected-owner start must refuse post-lifecycle PID drift with stable owner"
else
  pass "expected-owner start refuses post-lifecycle PID drift with stable owner"
fi
if [[ -e "$TMP_DIR/r-exp-pid-drift.json" ]]; then fail "no receipt on post-lifecycle PID drift"; else pass "no receipt on post-lifecycle PID drift"; fi
if grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log"; then pass "post-lifecycle PID drift cleans the exact id"; else fail "post-lifecycle PID drift cleans the exact id"; fi
rm -f -- "$TMP_DIR/r-exp-pid-drift.json"
# Malformed planner proofs refuse: bad NameHasOwner, bad GetNameOwner, bad PID.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
setup_planner_present ":1.99" 4343 434300
printf 'garbage' > "$FAKE_DIR/bad-planner-reply"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-exp-mal1.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 --expected-planner-owner ":1.99" >/dev/null 2>&1; then
  fail "expected-owner start must refuse malformed NameHasOwner"
else
  pass "expected-owner start refuses malformed NameHasOwner"
fi
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
setup_planner_present ":1.99" 4343 434300
printf 'garbage' > "$FAKE_DIR/bad-planner-owner-reply"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-exp-mal2.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 --expected-planner-owner ":1.99" >/dev/null 2>&1; then
  fail "expected-owner start must refuse malformed GetNameOwner"
else
  pass "expected-owner start refuses malformed GetNameOwner"
fi
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
setup_planner_present ":1.99" 4343 434300
printf '{"type":"u","data":[]}' > "$FAKE_DIR/bad-planner-pid-reply"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-exp-mal3.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 --expected-planner-owner ":1.99" >/dev/null 2>&1; then
  fail "expected-owner start must refuse malformed planner PID"
else
  pass "expected-owner start refuses malformed planner PID"
fi
# Expected mode skips only absence: production/advisory still enforced.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
setup_planner_present ":1.99" 4343 434300
printf 'b false' > "$FAKE_DIR/prod_reply"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-exp-prod.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 --expected-planner-owner ":1.99" >/dev/null 2>&1; then
  fail "expected-owner start must still require production"
else
  pass "expected-owner start still requires production"
fi

# 19: explicit strict terminal-refusal mode for a sequencer.
assert_contains "$LOADER" '--expected-refusal-detail'
assert_contains "$LOADER" '--expected-refusal-after'
assert_contains "$LOADER" '--refusal-service-loss'
assert_contains "$LOADER" 'refusal requires paired'
assert_contains "$LOADER" 'refusal conflicts with receipt semantics'
assert_absent "$LOADER" 'refusal service-loss conflicts'
assert_contains "$LOADER" 'refusal expectation mismatch'
assert_contains "$LOADER" 'refused: plugin='
assert_absent "$LOADER" 'reject:advisory-rejected*'
STALE_SVC_DETAIL="reject:advisory-rejected-stale-request"
TIMEOUT_DETAIL="reject:advisory-timeout"
STALE_SVC_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:$STALE_SVC_DETAIL"
TIMEOUT_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:$TIMEOUT_DETAIL"

# 19a: present-owner refusal success with the stale service reply pair.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
setup_planner_present ":1.99" 4343 434300
FAKE_RESULT="$STALE_SVC_RESULT"; FAKE_AFTER="$AFTER"; export FAKE_RESULT FAKE_AFTER
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-stale.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 5 --delay 0.01 --expected-planner-owner ":1.99" --expected-refusal-detail "$STALE_SVC_DETAIL" --expected-refusal-after true > "$TMP_DIR/o-ref-stale" 2>&1; then
  pass "present-owner refusal accepts stale service reply"
else
  fail "present-owner refusal accepts stale service reply"
fi
if grep -qF 'refused: plugin=plasma-auto-tiler-advisory-describe' "$TMP_DIR/o-ref-stale" && grep -qF "detail=$STALE_SVC_DETAIL" "$TMP_DIR/o-ref-stale"; then
  pass "refusal success reports the exact pair"
else
  fail "refusal success reports the exact pair"
fi
if [[ ! -e "$TMP_DIR/r-ref-stale.json" ]]; then pass "refusal success leaves no receipt"; else fail "refusal success leaves no receipt"; fi
if grep -qF "/Scripting/Script3 org.kde.kwin.Script stop" "$FAKE_DIR/calls.log" && grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log"; then
  pass "refusal success exact-cleans only the recorded id"
else
  fail "refusal success exact-cleans only the recorded id"
fi
if grep -qF 'GetNameOwner s org.plasmaautotiler.Planner' "$FAKE_DIR/calls.log"; then
  pass "present-owner refusal post-revalidates before accepting"
else
  fail "present-owner refusal post-revalidates before accepting"
fi
if [[ "$(grep -cF 'GetNameOwner s org.plasmaautotiler.Planner' "$FAKE_DIR/calls.log")" -eq 3 ]]; then
  pass "non-service-loss refusal still postchecks the present owner"
else
  fail "non-service-loss refusal still postchecks the present owner"
fi
if grep -qF 'unloadScript s plasma-auto-tiler-kwin' "$FAKE_DIR/calls.log" || grep -qF "loadScript ss $BUNDLE plasma-auto-tiler-kwin" "$FAKE_DIR/calls.log"; then fail "production never mutated on refusal"; else pass "production never mutated on refusal"; fi
rm -f -- "$TMP_DIR/r-ref-stale.json"

# 19b: service-loss refusal with the pinned present owner starts while the
# Planner exists, then intentionally loses it. Full initial exact-present
# owner/PID/tick checks run; only the final post-lifecycle present-owner
# check is skipped. Accepts the exact timeout pair with no receipt.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
setup_planner_present ":1.99" 4343 434300
FAKE_RESULT="$TIMEOUT_RESULT"; FAKE_AFTER="$AFTER"; export FAKE_RESULT FAKE_AFTER
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-timeout.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 5 --delay 0.01 --expected-planner-owner ":1.99" --expected-refusal-detail "$TIMEOUT_DETAIL" --expected-refusal-after true --refusal-service-loss > "$TMP_DIR/o-ref-timeout" 2>&1; then
  pass "service-loss refusal accepts timeout reply with pinned owner"
else
  fail "service-loss refusal accepts timeout reply with pinned owner"
fi
if grep -qF 'service-loss' "$TMP_DIR/o-ref-timeout" && grep -qF "detail=$TIMEOUT_DETAIL" "$TMP_DIR/o-ref-timeout"; then
  pass "service-loss success reports the distinct mode"
else
  fail "service-loss success reports the distinct mode"
fi
if [[ ! -e "$TMP_DIR/r-ref-timeout.json" ]]; then pass "service-loss leaves no receipt"; else fail "service-loss leaves no receipt"; fi
if grep -qF "/Scripting/Script3 org.kde.kwin.Script stop" "$FAKE_DIR/calls.log" && grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log"; then
  pass "service-loss exact-cleans only the recorded id"
else
  fail "service-loss exact-cleans only the recorded id"
fi
if grep -qF 'GetNameOwner s org.plasmaautotiler.Planner' "$FAKE_DIR/calls.log"; then
  pass "service-loss with pinned owner retains the initial present-owner proof"
else
  fail "service-loss with pinned owner retains the initial present-owner proof"
fi
if [[ "$(grep -cF 'GetNameOwner s org.plasmaautotiler.Planner' "$FAKE_DIR/calls.log")" -eq 2 ]]; then
  pass "service-loss skips only the final post-lifecycle present-owner check"
else
  fail "service-loss skips only the final post-lifecycle present-owner check"
fi
rm -f -- "$TMP_DIR/r-ref-timeout.json"

# 19c: missing paired flags refused before transport.
reset_fake; seed_diag
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-pair1.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --expected-refusal-detail "$TIMEOUT_DETAIL" >/dev/null 2>&1; then
  fail "refusal must require paired after"
else
  pass "refusal requires paired after"
fi
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-pair2.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --expected-refusal-after true >/dev/null 2>&1; then
  fail "refusal must require paired detail"
else
  pass "refusal requires paired detail"
fi
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-pair3.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --refusal-service-loss >/dev/null 2>&1; then
  fail "service-loss must require the paired refusal"
else
  pass "service-loss requires the paired refusal"
fi
if [[ -s "$FAKE_DIR/calls.log" ]]; then fail "no bus traffic on missing paired refusal flags"; else pass "no bus traffic on missing paired refusal flags"; fi

# 19d: duplicate refusal flags refused.
reset_fake; seed_diag
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-dup.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --expected-refusal-detail "$TIMEOUT_DETAIL" --expected-refusal-detail "$TIMEOUT_DETAIL" --expected-refusal-after true >/dev/null 2>&1; then
  fail "refusal must reject duplicate detail"
else
  pass "refusal rejects duplicate detail"
fi
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-dup2.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --expected-refusal-detail "$TIMEOUT_DETAIL" --expected-refusal-after true --expected-refusal-after true >/dev/null 2>&1; then
  fail "refusal must reject duplicate after"
else
  pass "refusal rejects duplicate after"
fi
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-dup3.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --expected-refusal-detail "$TIMEOUT_DETAIL" --expected-refusal-after true --refusal-service-loss --refusal-service-loss >/dev/null 2>&1; then
  fail "refusal must reject duplicate service-loss"
else
  pass "refusal rejects duplicate service-loss"
fi

# 19e: malformed expected detail/verdict refused.
reset_fake; seed_diag
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-badd.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --expected-refusal-detail 'bad detail!' --expected-refusal-after true >/dev/null 2>&1; then
  fail "refusal must reject malformed detail"
else
  pass "refusal rejects malformed detail"
fi
BIG_REFUSE="$(printf 'c%.0s' $(seq 1 513))"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-bigd.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --expected-refusal-detail "$BIG_REFUSE" --expected-refusal-after true >/dev/null 2>&1; then
  fail "refusal must reject oversize detail"
else
  pass "refusal rejects oversize detail"
fi
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-bada.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --expected-refusal-detail "$TIMEOUT_DETAIL" --expected-refusal-after maybe >/dev/null 2>&1; then
  fail "refusal must reject malformed after"
else
  pass "refusal rejects malformed after"
fi
if [[ -s "$FAKE_DIR/calls.log" ]]; then fail "no bus traffic on malformed refusal expectation"; else pass "no bus traffic on malformed refusal expectation"; fi

# 19f: conflicting semantics refused.
reset_fake; seed_diag
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-conf1.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --expected-refusal-detail could-execute:R2a:swap-neighbor --expected-refusal-after true >/dev/null 2>&1; then
  fail "refusal must refuse receipt-conflicting pair"
else
  pass "refusal refuses receipt-conflicting pair"
fi
# 19f-prefix: refusal mode rejects any could-execute-prefixed detail with
# after true, including bare, unknown, or extra-segment forms.
for _pref_detail in "could-execute" "could-execute:R99:swap-neighbor" "could-execute:R2a:fly-away" "could-execute:R2a:swap-neighbor:extra"; do
  reset_fake; seed_diag
  if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-pref.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --expected-refusal-detail "$_pref_detail" --expected-refusal-after true >/dev/null 2>&1; then
    fail "refusal must refuse prefixed detail with after true: $_pref_detail"
  else
    pass "refusal refuses prefixed detail with after true: $_pref_detail"
  fi
  if [[ -e "$TMP_DIR/r-ref-pref.json" ]]; then fail "no receipt on prefixed refusal: $_pref_detail"; else pass "no receipt on prefixed refusal: $_pref_detail"; fi
  if [[ -s "$FAKE_DIR/calls.log" ]]; then fail "no bus traffic on prefixed refusal: $_pref_detail"; else pass "no bus traffic on prefixed refusal: $_pref_detail"; fi
  rm -f -- "$TMP_DIR/r-ref-pref.json"
done
# 19f2: service-loss with pinned owner fails before Script lifecycle on
# initial absent/mismatch/drift, proving the full initial exact-present
# owner/PID/tick checks still run.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-combo-absent.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 --expected-planner-owner ":1.99" --expected-refusal-detail "$TIMEOUT_DETAIL" --expected-refusal-after true --refusal-service-loss >/dev/null 2>&1; then
  fail "service-loss with pinned owner must refuse initial absent"
else
  pass "service-loss with pinned owner refuses initial absent"
fi
preflight_no_resources "service-loss-pinned-absent" "$TMP_DIR/r-ref-combo-absent.json"
rm -f -- "$TMP_DIR/r-ref-combo-absent.json"
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
setup_planner_present ":1.77" 4343 434300
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-combo-mismatch.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 --expected-planner-owner ":1.99" --expected-refusal-detail "$TIMEOUT_DETAIL" --expected-refusal-after true --refusal-service-loss >/dev/null 2>&1; then
  fail "service-loss with pinned owner must refuse initial mismatch"
else
  pass "service-loss with pinned owner refuses initial mismatch"
fi
preflight_no_resources "service-loss-pinned-mismatch" "$TMP_DIR/r-ref-combo-mismatch.json"
rm -f -- "$TMP_DIR/r-ref-combo-mismatch.json"
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
setup_planner_present ":1.99" 4343 434300
printf ':1.99\n:1.77\n' > "$FAKE_DIR/planner-owner-seq"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-combo-drift.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 --expected-planner-owner ":1.99" --expected-refusal-detail "$TIMEOUT_DETAIL" --expected-refusal-after true --refusal-service-loss >/dev/null 2>&1; then
  fail "service-loss with pinned owner must refuse initial drift"
else
  pass "service-loss with pinned owner refuses initial drift"
fi
preflight_no_resources "service-loss-pinned-drift" "$TMP_DIR/r-ref-combo-drift.json"
rm -f -- "$TMP_DIR/r-ref-combo-drift.json"

# 19g: mismatched observed pair fails closed with partial cleanup and no receipt.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="$TIMEOUT_RESULT"; FAKE_AFTER="$AFTER"; export FAKE_RESULT FAKE_AFTER
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-mismatch.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 5 --delay 0.01 --expected-refusal-detail "$STALE_SVC_DETAIL" --expected-refusal-after true --refusal-service-loss >/dev/null 2>&1; then
  fail "refusal must reject mismatched detail"
else
  pass "refusal rejects mismatched detail"
fi
if [[ -e "$TMP_DIR/r-ref-mismatch.json" ]]; then fail "no receipt on refusal mismatch"; else pass "no receipt on refusal mismatch"; fi
if grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log"; then pass "refusal mismatch cleans the exact id"; else fail "refusal mismatch cleans the exact id"; fi
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="$TIMEOUT_RESULT"; FAKE_AFTER="$AFTER_FALSE"; export FAKE_RESULT FAKE_AFTER
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-mismatch2.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 5 --delay 0.01 --expected-refusal-detail "$TIMEOUT_DETAIL" --expected-refusal-after true --refusal-service-loss >/dev/null 2>&1; then
  fail "refusal must reject mismatched after"
else
  pass "refusal rejects mismatched after"
fi
if grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log" && [[ ! -e "$TMP_DIR/r-ref-mismatch2.json" ]]; then
  pass "after mismatch cleans the exact id with no receipt"
else
  fail "after mismatch cleans the exact id with no receipt"
fi
# Prefix broadening refused: expected timeout must not accept timeout-extra.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:${TIMEOUT_DETAIL}-extra"; FAKE_AFTER="$AFTER"; export FAKE_RESULT FAKE_AFTER
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-prefix.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 5 --delay 0.01 --expected-refusal-detail "$TIMEOUT_DETAIL" --expected-refusal-after true --refusal-service-loss >/dev/null 2>&1; then
  fail "refusal must not broaden by prefix"
else
  pass "refusal refuses prefix broadening"
fi
if grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log" && [[ ! -e "$TMP_DIR/r-ref-prefix.json" ]]; then
  pass "prefix mismatch cleans the exact id with no receipt"
else
  fail "prefix mismatch cleans the exact id with no receipt"
fi
rm -f -- "$TMP_DIR/r-ref-mismatch.json" "$TMP_DIR/r-ref-mismatch2.json" "$TMP_DIR/r-ref-prefix.json"

# 19h: ordering still enforced in refusal mode.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="$TIMEOUT_RESULT"; FAKE_AFTER="$AFTER"; FAKE_ORDER="after-first"; export FAKE_RESULT FAKE_AFTER FAKE_ORDER
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-order.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 --expected-refusal-detail "$TIMEOUT_DETAIL" --expected-refusal-after true --refusal-service-loss >/dev/null 2>&1; then
  fail "refusal must reject out-of-order after"
else
  pass "refusal rejects out-of-order after"
fi
if [[ -e "$TMP_DIR/r-ref-order.json" ]]; then fail "no receipt on out-of-order refusal"; else pass "no receipt on out-of-order refusal"; fi
if grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log"; then pass "out-of-order refusal cleans the exact id"; else fail "out-of-order refusal cleans the exact id"; fi
rm -f -- "$TMP_DIR/r-ref-order.json"

# 19i: present-owner post-drift still refused in refusal mode.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
setup_planner_present ":1.99" 4343 434300
FAKE_RESULT="$STALE_SVC_RESULT"; FAKE_AFTER="$AFTER"; export FAKE_RESULT FAKE_AFTER
printf ':1.99\n:1.99\n:1.77\n' > "$FAKE_DIR/planner-owner-seq"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-ref-drift.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 5 --delay 0.01 --expected-planner-owner ":1.99" --expected-refusal-detail "$STALE_SVC_DETAIL" --expected-refusal-after true >/dev/null 2>&1; then
  fail "present-owner refusal must refuse post-lifecycle drift"
else
  pass "present-owner refusal refuses post-lifecycle drift"
fi
if [[ -e "$TMP_DIR/r-ref-drift.json" ]]; then fail "no receipt on refusal drift"; else pass "no receipt on refusal drift"; fi
if grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log"; then pass "refusal drift cleans the exact id"; else fail "refusal drift cleans the exact id"; fi
rm -f -- "$TMP_DIR/r-ref-drift.json"

# 20: strict success-detail predicate retains bounded advisory detail.
assert_contains "$LOADER" 'is_success_detail'
assert_contains "$LOADER" 'SUCCESS_RULES'
assert_contains "$LOADER" 'SUCCESS_CAPS'
assert_contains "$LOADER" 'SUCCESS_DETAIL_PREFIX'
assert_contains "$LOADER" 'emit_invocation_diag'
assert_contains "$LOADER" 'redact_diag_text'
assert_contains "$LOADER" 'DIAG_MAX_BYTES'
assert_contains "$LOADER" 'diag: invocation='

# 20a: bare could-execute with after true receives no receipt.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute"; FAKE_AFTER="$AFTER"; export FAKE_RESULT FAKE_AFTER
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-bare.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject bare could-execute"
else
  pass "start rejects bare could-execute"
fi
if [[ -e "$TMP_DIR/r-bare.json" ]]; then fail "no receipt on bare detail"; else pass "no receipt on bare detail"; fi
if grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log"; then pass "bare detail cleans the exact id"; else fail "bare detail cleans the exact id"; fi
rm -f -- "$TMP_DIR/r-bare.json"

# 20b: unknown rule/capability and extra segments fail closed.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute:R99:swap-neighbor"; export FAKE_RESULT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-rule.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject unknown rule"
else
  pass "start rejects unknown rule"
fi
rm -f -- "$TMP_DIR/r-rule.json"
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute:R2a:fly-away"; export FAKE_RESULT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-cap.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject unknown capability"
else
  pass "start rejects unknown capability"
fi
rm -f -- "$TMP_DIR/r-cap.json"
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute:R2a:swap-neighbor:extra"; export FAKE_RESULT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-extra.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject extra detail segments"
else
  pass "start rejects extra detail segments"
fi
rm -f -- "$TMP_DIR/r-extra.json"

# 20c: diagnostics with bare success detail and after true is refused.
printf '%s\n%s\n%s\n%s\n' "$READY" "$SOURCE_T" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute" "$AFTER" > "$TMP_DIR/diag-bare-true.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r0.json" --diag-file "$TMP_DIR/diag-bare-true.log" >/dev/null 2>&1; then
  fail "diagnostics must reject bare detail with after true"
else
  pass "diagnostics rejects bare detail with after true"
fi

# 20d: bus failure preserves causal bounded redacted invocation-tied diag
# before exact cleanup, with no native IDs and no guessed unload.
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
REAL_FAKE_BUSCTL="$FAKE_BIN/busctl"
cat > "$FAKE_BIN/busctl-diag-wrap" <<WRAP
#!/usr/bin/env bash
if printf '%s' "\$*" | grep -Fq 'loadScript'; then
  printf 'transport failure owner :1.99 pid 4343 hex aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa path /tmp/secret-bus-failure\n' >&2
  printf 'x%.0s' \$(seq 1 3000) >&2
  printf '\n' >&2
  exit 3
fi
exec "$REAL_FAKE_BUSCTL" "\$@"
WRAP
chmod +x -- "$FAKE_BIN/busctl-diag-wrap"
if BUSCTL_BIN="$FAKE_BIN/busctl-diag-wrap" "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-busdiag.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >"$TMP_DIR/o-busdiag.log" 2>"$TMP_DIR/e-busdiag.log"; then
  fail "start must fail on bus transport failure"
else
  pass "start fails on bus transport failure"
fi
if grep -qF 'diag: invocation=loadScript exit=3' "$TMP_DIR/e-busdiag.log" && grep -qF "correlation=$NONCE" "$TMP_DIR/e-busdiag.log"; then
  pass "bus diag is invocation-tied with exit and correlation"
else
  fail "bus diag is invocation-tied with exit and correlation"
fi
if grep -qF ':REDACTED' "$TMP_DIR/e-busdiag.log" && grep -qF 'REDACTED_HEX' "$TMP_DIR/e-busdiag.log" && grep -qF 'REDACTED_PATH' "$TMP_DIR/e-busdiag.log"; then
  pass "bus diag redacts native IDs and paths"
else
  fail "bus diag redacts native IDs and paths"
fi
if grep -qF ':1.99' "$TMP_DIR/e-busdiag.log" || grep -qF '/tmp/secret-bus-failure' "$TMP_DIR/e-busdiag.log"; then
  fail "bus diag leaks no native IDs"
else
  pass "bus diag leaks no native IDs"
fi
if grep -qF 'pid 4343' "$TMP_DIR/e-busdiag.log" || grep -qE '(^|[^0-9A-Z_])4343([^0-9]|$)' "$TMP_DIR/e-busdiag.log"; then
  fail "bus diag leaks no numeric native PIDs"
else
  pass "bus diag leaks no numeric native PIDs"
fi
if grep -qF 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' "$TMP_DIR/e-busdiag.log"; then
  fail "bus diag leaks no raw hex identities"
else
  pass "bus diag leaks no raw hex identities"
fi
_DIAG_STDERR="$(sed -n 's/.*stderr=//p' "$TMP_DIR/e-busdiag.log" | head -n 1)"
if [[ "${#_DIAG_STDERR}" -le 1024 ]]; then pass "bus diag stderr is bounded"; else fail "bus diag stderr is bounded"; fi
if [[ "$(grep -cF 'diag: invocation=' "$TMP_DIR/e-busdiag.log")" -eq 1 ]]; then pass "bus diag remains one bounded log record"; else fail "bus diag remains one bounded log record"; fi
if grep -qF 'diag: invocation=loadScript exit=3' "$TMP_DIR/e-busdiag.log" && grep -qF "correlation=$NONCE" "$TMP_DIR/e-busdiag.log"; then
  pass "bus diag preserves invocation/exit/correlation"
else
  fail "bus diag preserves invocation/exit/correlation"
fi
if [[ -e "$TMP_DIR/r-busdiag.json" ]]; then fail "no receipt on bus failure"; else pass "no receipt on bus failure"; fi
if grep -qF 'unloadScript' "$FAKE_DIR/calls.log"; then fail "no guessed unload on unknown object"; else pass "no guessed unload on unknown object"; fi
rm -f -- "$TMP_DIR/r-busdiag.json" "$TMP_DIR/o-busdiag.log" "$TMP_DIR/e-busdiag.log"

# 20e: exact cleanup preserves causal stop/unload/state diags with the
# start correlation (no "none") before cleanup.
assert_contains "$LOADER" 'ACTIVE_CORR'
assert_contains "$LOADER" 'emit_invocation_diag "stop"'
assert_contains "$LOADER" 'emit_invocation_diag "unloadScript"'
assert_contains "$LOADER" 'emit_invocation_diag "state"'
reset_fake; seed_diag; queue_loaded "b false" "b false" "b false" "b true"
FAKE_UNLOAD_EXIT=1; export FAKE_UNLOAD_EXIT
FAKE_RESULT="$STALE_RESULT"; FAKE_AFTER="$AFTER_FALSE"; export FAKE_RESULT FAKE_AFTER
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-uccorr.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 --expected-refusal-detail "reject:advisory-stale-snapshot" --expected-refusal-after false >"$TMP_DIR/o-uccorr.log" 2>"$TMP_DIR/e-uccorr.log"; then
  fail "refusal cleanup must fail on unload failure"
else
  pass "refusal cleanup fails on unload failure"
fi
if grep -qF 'diag: invocation=unloadScript' "$TMP_DIR/e-uccorr.log" && grep -qF "correlation=$NONCE" "$TMP_DIR/e-uccorr.log"; then
  pass "unload diag carries the start correlation"
else
  fail "unload diag carries the start correlation"
fi
if grep -qF 'correlation=none' "$TMP_DIR/e-uccorr.log"; then
  fail "cleanup diags use known correlation, not none"
else
  pass "cleanup diags use known correlation, not none"
fi
FAKE_UNLOAD_EXIT=0; export FAKE_UNLOAD_EXIT
rm -f -- "$TMP_DIR/r-uccorr.json" "$TMP_DIR/o-uccorr.log" "$TMP_DIR/e-uccorr.log"

# Cleanup proof: built and temp artifacts removed, ignored/untracked.
rm -f -- "$BUNDLE" "$MANIFEST"
if [[ ! -e "$BUNDLE" && ! -e "$MANIFEST" ]]; then pass "built outputs removed"; else fail "built outputs removed"; fi
if git -C "$REPO_ROOT" status --porcelain -- kwin/dist/advisory-describe.js kwin/dist/advisory-describe.manifest.json | grep -q .; then fail "forbidden present: tracked build residue"; else pass "absent: tracked build residue"; fi

printf 'advisory-describe host static: pass=%s fail=%s\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
