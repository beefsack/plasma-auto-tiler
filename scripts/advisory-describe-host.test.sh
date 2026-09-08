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

# Narrow project-namespaced interface with receipt-scoped commands.
assert_contains "$LOADER" 'PLUGIN="plasma-auto-tiler-advisory-describe"'
assert_contains "$LOADER" 'start --bundle B --manifest M --receipt R --diag-file D --input I'
assert_contains "$LOADER" 'status --receipt R'
assert_contains "$LOADER" 'diagnostics --receipt R'
assert_contains "$LOADER" 'stop --receipt R'
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
assert_contains "$LOADER" 'advisory-describe-source'
assert_contains "$LOADER" 'RESULT_SCHEMA="v1"'
assert_contains "$LOADER" 'check_result_line'
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
assert_contains "$LOADER" 'partial script-id='
# Only the pinned bus/sha/node tools run; no generic IPC or POC tooling.
if [[ "$(grep -o '"\$[A-Z0-9_]*BIN"' "$LOADER" | sort -u | tr '\n' ' ')" == '"$BUSCTL_BIN" "$NODE_BIN" "$SHA256SUM_BIN" ' ]]; then
  pass "only pinned bus/sha/node commands run"
else
  fail "only pinned bus/sha/node commands run"
fi
assert_absent "$LOADER" 'Script0'
assert_absent "$LOADER" 'PRODUCTION'
assert_absent "$LOADER" 'Scripting start'
assert_absent "$LOADER" 'poc3-'
assert_absent "$LOADER" 'poc3_'
assert_absent "$LOADER" 'scripts/poc3'
assert_absent "$LOADER" 'nested-'
if grep -o 'unloadScript s "[^"]*"' "$LOADER" | sort -u | tr '\n' ' ' | grep -qF 'unloadScript s "$PLUGIN" unloadScript s "$RECEIPT_PLUGIN"'; then
  pass "unload targets only the recorded plugin"
else
  fail "unload targets only the recorded plugin"
fi

# Fake busctl fixture: behavior driven only by files under FAKE_DIR, every
# invocation appended to calls.log for exact-sequence assertions.
cat > "$FAKE_BIN/busctl" <<'FAKE_BUSCTL'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_DIR/calls.log"
if printf '%s' "$*" | grep -Fq 'unloadScript'; then
  cat -- "$FAKE_DIR/unload_reply"
  exit "${FAKE_UNLOAD_EXIT:-0}"
fi
if printf '%s' "$*" | grep -Fq 'loadScript'; then
  cat -- "$FAKE_DIR/load_reply"
  exit "${FAKE_LOAD_EXIT:-0}"
fi
if [[ "${1:-}" == "introspect" ]]; then
  cat -- "$FAKE_DIR/introspect_reply"
  exit "${FAKE_INTROSPECT_EXIT:-0}"
fi
if printf '%s' "$*" | grep -Fq 'isScriptLoaded'; then
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
    printf '%s\n' "${FAKE_SOURCE:-}" "${FAKE_READY:-}" "${FAKE_RESULT:-}" >> "${FAKE_DIAG:-/dev/null}"
  fi
  exit "${FAKE_RUN_EXIT:-0}"
fi
if [[ "${*: -1}" == "stop" ]]; then
  exit "${FAKE_STOP_EXIT:-0}"
fi
exit 1
FAKE_BUSCTL
chmod +x -- "$FAKE_BIN/busctl"

export BUSCTL_BIN="$FAKE_BIN/busctl"
export FAKE_DIR
export FAKE_DIAG="$TMP_DIR/diag.log"
export FAKE_APPEND=1

reset_fake() {
  rm -f -- "$FAKE_DIR/calls.log" "$FAKE_DIR/is_loaded_count" "$FAKE_DIR/is_loaded_seq" "$FAKE_DIR/is_loaded_queue"
  printf 'i 3' > "$FAKE_DIR/load_reply"
  printf 'interface org.kde.kwin.Script { };' > "$FAKE_DIR/introspect_reply"
  printf 'b false' > "$FAKE_DIR/is_loaded_reply"
  printf 'b true' > "$FAKE_DIR/unload_reply"
  FAKE_LOAD_EXIT=0; FAKE_INTROSPECT_EXIT=0; FAKE_RUN_EXIT=0; FAKE_STOP_EXIT=0; FAKE_UNLOAD_EXIT=0
  export FAKE_LOAD_EXIT FAKE_INTROSPECT_EXIT FAKE_RUN_EXIT FAKE_STOP_EXIT FAKE_UNLOAD_EXIT
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
RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute"

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
  local entry_sha query_sha
  entry_sha="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-describe-entry.ts" | cut -d' ' -f1)"
  query_sha="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-plan-query.ts" | cut -d' ' -f1)"
  FAKE_SOURCE="plasma-auto-tiler:advisory-describe-source:$entry_sha:$query_sha"
  FAKE_READY="$READY"
  FAKE_RESULT="$RESULT"
  FAKE_APPEND=1
  export FAKE_SOURCE FAKE_READY FAKE_RESULT FAKE_APPEND
}

start_args() {
  printf '%s\n' --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$1" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 5 --delay 0.01
}

# 1: start success with a valid non-zero id.
reset_fake; seed_diag; queue_loaded "b false" "b true"
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
  && grep -qF "introspect org.kde.KWin /Scripting/Script3" "$FAKE_DIR/calls.log" \
  && grep -qF "/Scripting/Script3 org.kde.kwin.Script run" "$FAKE_DIR/calls.log"; then
  pass "exact Script path and object run"
else
  fail "exact Script path and object run"
fi
if grep -qF 'plasma-auto-tiler-kwin' "$FAKE_DIR/calls.log"; then fail "production untouched on start"; else pass "production untouched on start"; fi
if grep -qF 'Scripting start' "$FAKE_DIR/calls.log"; then fail "no global start on start"; else pass "no global start on start"; fi

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
reset_fake; seed_diag; queue_loaded "b false" "b true"
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
  if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-bad.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
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
  rm -f -- "$TMP_DIR/r-bad.json"
done

# 6: run failure triggers partial cleanup of the exact id only.
reset_fake; seed_diag; queue_loaded "b false" "b true"
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
reset_fake; seed_diag; queue_loaded "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE2:$OWNER:$GENERATION:$REVISION:$NONCE2:could-execute"
export FAKE_RESULT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-corr.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject wrong correlation"
else
  pass "start rejects wrong correlation"
fi
if [[ -e "$TMP_DIR/r-corr.json" ]]; then fail "no receipt on correlation mismatch"; else pass "no receipt on correlation mismatch"; fi
if grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log"; then pass "correlation mismatch cleans the exact id"; else fail "correlation mismatch cleans the exact id"; fi
reset_fake; seed_diag; queue_loaded "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:lost-owner:$GENERATION:$REVISION:$NONCE:could-execute"
export FAKE_RESULT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-owner.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject owner loss"
else
  pass "start rejects owner loss"
fi
if grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log"; then pass "owner loss cleans the exact id"; else fail "owner loss cleans the exact id"; fi

# 7b/7c: wrong generation/revision/nonce fail closed; unversioned prefix rejected.
reset_fake; seed_diag; queue_loaded "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:WRONG:$REVISION:$NONCE:could-execute"
export FAKE_RESULT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-gen.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject wrong generation"
else
  pass "start rejects wrong generation"
fi
reset_fake; seed_diag; queue_loaded "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:999:$NONCE:could-execute"
export FAKE_RESULT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-rev.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject wrong revision"
else
  pass "start rejects wrong revision"
fi
reset_fake; seed_diag; queue_loaded "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE2:could-execute"
export FAKE_RESULT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-nonce.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject wrong nonce"
else
  pass "start rejects wrong nonce"
fi
reset_fake; seed_diag; queue_loaded "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute"
export FAKE_RESULT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-unver.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject an unversioned result"
else
  pass "start rejects an unversioned result"
fi

# 7d: mid-line prefix, empty detail, and oversize detail rejected.
reset_fake; seed_diag; queue_loaded "b false" "b true"
FAKE_RESULT="xx plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute"
export FAKE_RESULT
# Fake appends source/ready/result lines; prepend junk on the result line to force a mid-line match.
FAKE_APPEND=1; export FAKE_APPEND
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-mid.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject a mid-line prefix"
else
  pass "start rejects a mid-line prefix"
fi
reset_fake; seed_diag; queue_loaded "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:"
export FAKE_RESULT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-empty.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject empty detail"
else
  pass "start rejects empty detail"
fi
reset_fake; seed_diag; queue_loaded "b false" "b true"
BIG_DETAIL="$(printf 'a%.0s' $(seq 1 513))"
FAKE_RESULT="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:$BIG_DETAIL"
export FAKE_RESULT
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-big.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject oversize detail"
else
  pass "start rejects oversize detail"
fi

# 9: timeout with no markers fails closed with exact cleanup.
reset_fake; seed_diag; queue_loaded "b false" "b true"
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
reset_fake; seed_diag; queue_loaded "b false" "b true"
printf '%s\n%s\n%s\n' "$FAKE_SOURCE" "$READY" "$RESULT" > "$TMP_DIR/diag.log"
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
reset_fake; seed_diag; queue_loaded "b false" "b true"
FAKE_SOURCE="plasma-auto-tiler:advisory-describe-source:0000000000000000000000000000000000000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000"
export FAKE_SOURCE
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-srcbad.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject a mismatched source marker"
else
  pass "start rejects a mismatched source marker"
fi
reset_fake; seed_diag; queue_loaded "b false" "b true"
FAKE_SOURCE=""; export FAKE_SOURCE
FAKE_APPEND=1; export FAKE_APPEND
# Empty source line cannot equal the bound marker; loader must still fail.
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-srcmiss.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject a missing source marker"
else
  pass "start rejects a missing source marker"
fi

# 10: missing Script interface on the exact object fails closed.
reset_fake; seed_diag; queue_loaded "b false" "b true"
printf 'no interfaces here' > "$FAKE_DIR/introspect_reply"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-iface.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must reject a foreign object"
else
  pass "start rejects a foreign object"
fi
if grep -qF "unloadScript s plasma-auto-tiler-advisory-describe" "$FAKE_DIR/calls.log"; then pass "foreign object cleans the exact id"; else fail "foreign object cleans the exact id"; fi

# 11: the static advisory-only gate refuses a tainted bundle before any bus call.
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
if [[ -s "$FAKE_DIR/calls.log" ]]; then fail "no bus traffic after static refusal"; else pass "no bus traffic after static refusal"; fi

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
if [[ -s "$FAKE_DIR/calls.log" ]]; then fail "no bus traffic on altered bundle"; else pass "no bus traffic on altered bundle"; fi
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
RESULT_D="plasma-auto-tiler:advisory-describe-result:v1:$NONCE:workspace.x:$GENERATION:$REVISION:$NONCE:could-execute"
ENTRY_SHA_D="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-describe-entry.ts" | cut -d' ' -f1)"
QUERY_SHA_D="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-plan-query.ts" | cut -d' ' -f1)"
printf 'pre-run padding line\n' > "$TMP_DIR/diag.log"
FAKE_SOURCE="plasma-auto-tiler:advisory-describe-source:$ENTRY_SHA_D:$QUERY_SHA_D"
FAKE_READY="$READY_D"; FAKE_RESULT="$RESULT_D"; FAKE_APPEND=1; FAKE_DIAG="$TMP_DIR/diag.log"
export FAKE_SOURCE FAKE_READY FAKE_RESULT FAKE_APPEND FAKE_DIAG
queue_loaded "b false" "b true"
cp -- "$TMP_DIR/request-denied-saved.json" "$TMP_DIR/request.json"
if node "$BUILDER" --input "$TMP_DIR/request.json" --out "$BUNDLE" >/dev/null 2>&1; then pass "fixture rebuilt for denied-text"; else fail "fixture rebuilt for denied-text"; fi
seed_diag
FAKE_READY="$READY_D"; FAKE_RESULT="$RESULT_D"; export FAKE_READY FAKE_RESULT
ENTRY_SHA_D="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-describe-entry.ts" | cut -d' ' -f1)"
QUERY_SHA_D="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-plan-query.ts" | cut -d' ' -f1)"
FAKE_SOURCE="plasma-auto-tiler:advisory-describe-source:$ENTRY_SHA_D:$QUERY_SHA_D"; export FAKE_SOURCE
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

# 13: start refuses when a receipt is already recorded.
reset_fake; seed_diag
printf '{"schema":"advisory-describe-receipt-v1"}' > "$TMP_DIR/r-taken.json"
if "$LOADER" start --bundle "$BUNDLE" --manifest "$MANIFEST" --receipt "$TMP_DIR/r-taken.json" --diag-file "$TMP_DIR/diag.log" --input "$TMP_DIR/request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "start must refuse an existing receipt"
else
  pass "start refuses an existing receipt"
fi
if [[ -s "$FAKE_DIR/calls.log" ]]; then fail "no bus traffic on existing receipt"; else pass "no bus traffic on existing receipt"; fi

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
if grep -qF 'plasma-auto-tiler-kwin' "$FAKE_DIR/calls.log"; then fail "production untouched on already-loaded"; else pass "production untouched on already-loaded"; fi
if [[ -e "$TMP_DIR/r-already.json" ]]; then fail "no receipt when already loaded"; else pass "no receipt when already loaded"; fi

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
printf '%s\n%s\n%s\n' "$READY" "plasma-auto-tiler:advisory-describe-source:$ENTRY_SHA_T:$QUERY_SHA_T" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE2:could-execute" > "$TMP_DIR/diag-bad-nonce.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-bad-nonce.log" >/dev/null 2>&1; then
  fail "diagnostics must reject a wrong-nonce result"
else
  pass "diagnostics rejects a wrong-nonce result"
fi
# Diagnostics applies the same versioned anchored rules: mid-line, empty,
# oversize, wrong generation/revision, and missing source all fail.
printf '%s\n%s\n%s\n' "$READY" "plasma-auto-tiler:advisory-describe-source:$ENTRY_SHA_T:$QUERY_SHA_T" "xx plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute" > "$TMP_DIR/diag-mid.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-mid.log" >/dev/null 2>&1; then
  fail "diagnostics must reject a mid-line prefix"
else
  pass "diagnostics rejects a mid-line prefix"
fi
printf '%s\n%s\n%s\n' "$READY" "plasma-auto-tiler:advisory-describe-source:$ENTRY_SHA_T:$QUERY_SHA_T" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:" > "$TMP_DIR/diag-empty.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-empty.log" >/dev/null 2>&1; then
  fail "diagnostics must reject empty detail"
else
  pass "diagnostics rejects empty detail"
fi
BIG_D="$(printf 'b%.0s' $(seq 1 513))"
printf '%s\n%s\n%s\n' "$READY" "plasma-auto-tiler:advisory-describe-source:$ENTRY_SHA_T:$QUERY_SHA_T" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:$BIG_D" > "$TMP_DIR/diag-big.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-big.log" >/dev/null 2>&1; then
  fail "diagnostics must reject oversize detail"
else
  pass "diagnostics rejects oversize detail"
fi
printf '%s\n%s\n%s\n' "$READY" "plasma-auto-tiler:advisory-describe-source:$ENTRY_SHA_T:$QUERY_SHA_T" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:WRONG:$REVISION:$NONCE:could-execute" > "$TMP_DIR/diag-gen.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-gen.log" >/dev/null 2>&1; then
  fail "diagnostics must reject wrong generation"
else
  pass "diagnostics rejects wrong generation"
fi
printf '%s\n%s\n%s\n' "$READY" "plasma-auto-tiler:advisory-describe-source:$ENTRY_SHA_T:$QUERY_SHA_T" "plasma-auto-tiler:advisory-describe-result:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute" > "$TMP_DIR/diag-unver.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-unver.log" >/dev/null 2>&1; then
  fail "diagnostics must reject an unversioned result"
else
  pass "diagnostics rejects an unversioned result"
fi
printf '%s\n%s\n' "$READY" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute" > "$TMP_DIR/diag-nosrc.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-nosrc.log" >/dev/null 2>&1; then
  fail "diagnostics must reject a missing source marker"
else
  pass "diagnostics rejects a missing source marker"
fi
# 15a: diagnostics validates only the bounded 64KiB tail.
{
  printf '%s\n%s\n%s\n' "$READY" "plasma-auto-tiler:advisory-describe-source:$ENTRY_SHA_T:$QUERY_SHA_T" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute"
  head -c 70000 /dev/zero | tr '\0' 'p'; printf '\n'
} > "$TMP_DIR/diag-old-tail.log"
if "$LOADER" diagnostics --receipt "$TMP_DIR/r-diag.json" --diag-file "$TMP_DIR/diag-old-tail.log" >/dev/null 2>&1; then
  fail "diagnostics must ignore valid markers outside the bounded tail"
else
  pass "diagnostics ignores valid markers outside the bounded tail"
fi
{
  head -c 70000 /dev/zero | tr '\0' 'p'; printf '\n'
  printf '%s\n%s\n%s\n' "$READY" "plasma-auto-tiler:advisory-describe-source:$ENTRY_SHA_T:$QUERY_SHA_T" "plasma-auto-tiler:advisory-describe-result:v1:$NONCE:$OWNER:$GENERATION:$REVISION:$NONCE:could-execute"
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

# Cleanup proof: built and temp artifacts removed, ignored/untracked.
rm -f -- "$BUNDLE" "$MANIFEST"
if [[ ! -e "$BUNDLE" && ! -e "$MANIFEST" ]]; then pass "built outputs removed"; else fail "built outputs removed"; fi
if git -C "$REPO_ROOT" status --porcelain -- kwin/dist/advisory-describe.js kwin/dist/advisory-describe.manifest.json | grep -q .; then fail "forbidden present: tracked build residue"; else pass "absent: tracked build residue"; fi

printf 'advisory-describe host static: pass=%s fail=%s\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
