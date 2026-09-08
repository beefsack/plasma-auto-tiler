#!/usr/bin/env bash
# Focused hermetic test for the retained disabled shadow lifecycle command.
# No host bus/KWin/process contact: loader, builder, planner, busctl, and
# /proc are all faked behind explicit test-only gates
# (SHADOW_LIFECYCLE_TEST_FAKE=1 plus SHADOW_* overrides). Real node/coreutils
# perform pure local compute only. The real shadow builder plus real shadow
# loader (via the thin wrapper) are exercised against a fake bus for exact
# lifecycle/determinism/parser checks; the lifecycle command itself is
# exercised against fake loader/builder/planner for pin/loss/disabled checks.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
LIFECYCLE="$REPO_ROOT/scripts/shadow-lifecycle.sh"
WRAPPER="$REPO_ROOT/scripts/shadow-describe.sh"
LOADER="$REPO_ROOT/scripts/advisory-describe-host.sh"
BUILDER="$REPO_ROOT/scripts/advisory-describe-build.mjs"
SHADOW_BUILDER="$REPO_ROOT/scripts/shadow-describe-build.mjs"
SHADOW_BUILDER_REAL="$SHADOW_BUILDER"
PASS=0
FAIL=0

TMP_DIR=""
cleanup() {
  if [[ -n "${TMP_DIR:-}" && -d "$TMP_DIR" ]]; then
    if [[ -f "$TMP_DIR/fake/planner-alive" ]]; then
      kill -TERM -- "$(cat -- "$TMP_DIR/fake/planner-alive" 2>/dev/null)" 2>/dev/null || true
    fi
    if [[ -f "$TMP_DIR/fake/follower-pids.log" ]]; then
      while read -r p || [[ -n "$p" ]]; do
        [[ "$p" =~ ^[1-9][0-9]*$ ]] || continue
        kill -TERM -- "$p" 2>/dev/null || true
      done < "$TMP_DIR/fake/follower-pids.log"
    fi
    rm -rf -- "$TMP_DIR" 2>/dev/null || true
  fi
  rm -f -- "$REPO_ROOT/kwin/dist/shadow-describe.js" "$REPO_ROOT/kwin/dist/shadow-describe.manifest.json" 2>/dev/null || true
}
trap cleanup EXIT

TMP_DIR="$(mktemp -d)"
FAKE_DIR="$TMP_DIR/fake"
FAKE_BIN="$TMP_DIR/fakebin"
FAKE_DIST="$TMP_DIR/dist"
FAKE_TMP="$TMP_DIR/tmp"
FAKE_PROC="$TMP_DIR/proc"
mkdir -p -- "$FAKE_DIR" "$FAKE_BIN" "$FAKE_DIST" "$FAKE_TMP" "$FAKE_PROC"

pass() { PASS=$((PASS + 1)); printf 'pass: %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'fail: %s\n' "$1"; }

assert_contains() {
  if grep -qF -- "$2" "$1"; then pass "contains: $2"; else fail "missing: $2"; fi
}

assert_absent() {
  if grep -qF -- "$2" "$1"; then fail "forbidden present: $2"; else pass "absent: $2"; fi
}

if bash -n "$LIFECYCLE" >/dev/null 2>&1; then pass "bash -n lifecycle"; else fail "bash -n lifecycle"; fi
if bash -n "$WRAPPER" >/dev/null 2>&1; then pass "bash -n shadow wrapper"; else fail "bash -n shadow wrapper"; fi
if bash -n "$REPO_ROOT/scripts/shadow-lifecycle.test.sh" >/dev/null 2>&1; then pass "bash -n self"; else fail "bash -n self"; fi
if node --check "$BUILDER" >/dev/null 2>&1; then pass "node --check advisory builder"; else fail "node --check advisory builder"; fi
if node --check "$SHADOW_BUILDER" >/dev/null 2>&1; then pass "node --check shadow builder"; else fail "node --check shadow builder"; fi

# Selection: thin wrappers select shadow; production cannot reach shadow.
assert_contains "$WRAPPER" 'SHADOW_DESCRIBE_HOST_MODE="shadow"'
assert_contains "$WRAPPER" 'advisory-describe-host.sh'
assert_contains "$SHADOW_BUILDER" 'SHADOW_DESCRIBE_BUILD_MODE = "shadow"'
assert_contains "$SHADOW_BUILDER" 'advisory-describe-build.mjs'
if grep -rn 'SHADOW_DESCRIBE_HOST_MODE\|SHADOW_DESCRIBE_BUILD_MODE' "$REPO_ROOT/kwin/src/entry.ts" "$REPO_ROOT/src" 2>/dev/null | grep .; then
  fail "production never selects shadow mode"
else
  pass "production never selects shadow mode"
fi
if grep -rn 'shadow-describe' "$REPO_ROOT/kwin/src/entry.ts" 2>/dev/null | grep .; then
  fail "production entry never imports shadow"
else
  pass "production entry never imports shadow"
fi
if grep -rn 'advisory-describe\|advisory-plan-query' "$REPO_ROOT/kwin/src/entry.ts" 2>/dev/null | grep .; then
  fail "production entry never imports advisory query"
else
  pass "production entry never imports advisory query"
fi

# Lifecycle static contract: single disabled command, shared primitives.
assert_contains "$LIFECYCLE" 'SHADOW_LIFECYCLE_ALLOW'
assert_contains "$LIFECYCLE" 'is disabled by default'
assert_contains "$LIFECYCLE" 'run takes no arguments'
assert_contains "$LIFECYCLE" 'unknown command (expected run)'
assert_contains "$LIFECYCLE" 'shadow-describe.sh'
assert_contains "$LIFECYCLE" 'shadow-describe-build.mjs'
assert_contains "$LIFECYCLE" 'shadow-describe.js'
assert_contains "$LIFECYCLE" 'shadow-describe.manifest.json'
assert_contains "$LIFECYCLE" 'loader_preflight'
assert_contains "$LIFECYCLE" 'loader_start'
assert_contains "$LIFECYCLE" '"$loader" stop --receipt'
assert_contains "$LIFECYCLE" '"$loader" diagnostics --receipt'
assert_contains "$LIFECYCLE" 'planner-service'
assert_contains "$LIFECYCLE" 'no restart'
assert_contains "$LIFECYCLE" 'NameHasOwner'
assert_contains "$LIFECYCLE" 'GetNameOwner'
assert_contains "$LIFECYCLE" 'GetConnectionUnixProcessID'
assert_contains "$LIFECYCLE" 'NameHasOwner s "$PLANNER_OWNER"'
assert_contains "$LIFECYCLE" 'pinned planner owner is malformed for loss proof'
assert_contains "$LIFECYCLE" 'exact_planner_stop'
assert_contains "$LIFECYCLE" 'prove_planner_owner_loss'
assert_contains "$LIFECYCLE" 'phases=shadow'
assert_contains "$LIFECYCLE" 'continuity=verified'
assert_contains "$LIFECYCLE" 'preserving exact residue'
assert_contains "$LIFECYCLE" 'shadow-transport-'
assert_contains "$LIFECYCLE" 'randomBytes(32)'
assert_contains "$LIFECYCLE" 'fresh runtime dir collision'
assert_contains "$LIFECYCLE" 'exact shadow build output collision'
assert_contains "$LIFECYCLE" 'SHADOW_LIFECYCLE_TEST_FAKE'
assert_contains "$LIFECYCLE" 'is test-only (requires SHADOW_LIFECYCLE_TEST_FAKE=1)'
assert_contains "$LIFECYCLE" 'shadow_emit_diag'
assert_contains "$LIFECYCLE" 'shadow_redact_text'
assert_contains "$LIFECYCLE" 'diag: invocation='
assert_contains "$LIFECYCLE" 'preflight-source-only'
assert_contains "$LIFECYCLE" 'preflight:source-only'
assert_contains "$LIFECYCLE" '--verify --input'
assert_contains "$LIFECYCLE" 'verify:bootstrap'
assert_contains "$LIFECYCLE" 'builder is unavailable'
assert_contains "$LIFECYCLE" 'local RUNDIR_PARENT'
# No broad harness/enumeration/global start/broad lifecycle in the command.
assert_absent "$LIFECYCLE" 'loadScript'
assert_absent "$LIFECYCLE" 'unloadScript'
assert_absent "$LIFECYCLE" 'isScriptLoaded'
assert_absent "$LIFECYCLE" 'Scripting start'
assert_absent "$LIFECYCLE" 'ListNames'
assert_absent "$LIFECYCLE" 'workspace.'
assert_absent "$LIFECYCLE" 'registerShortcut'
assert_absent "$LIFECYCLE" 'windowList'
assert_absent "$LIFECYCLE" 'clientArea'
assert_absent "$LIFECYCLE" 'journalctl'
assert_absent "$LIFECYCLE" 'systemd-run'
assert_absent "$LIFECYCLE" 'XDG_RUNTIME_DIR'
assert_absent "$LIFECYCLE" 'Script0'
if grep -v '^[[:space:]]*#' "$LIFECYCLE" | grep -w -F 'busctl' | grep -v -F 'BUSCTL_BIN' > /dev/null; then
  fail "lifecycle busctl contact must be pinned via BUSCTL_BIN"
else
  pass "lifecycle busctl contact is pinned via BUSCTL_BIN"
fi

# Shared host dispatches shadow exactly; advisory default unchanged.
assert_contains "$LOADER" 'SHADOW_DESCRIBE_HOST_MODE'
assert_contains "$LOADER" 'plasma-auto-tiler-shadow-describe'
assert_contains "$LOADER" 'shadow-describe.js'
assert_contains "$LOADER" 'shadow-describe-manifest-v1'
assert_contains "$LOADER" 'shadow-describe-receipt-v1'
assert_contains "$LOADER" 'is_shadow_success_detail'
assert_contains "$LOADER" 'is_terminal_success_detail'
assert_contains "$LOADER" 'shadowSha256'
assert_contains "$LOADER" 'plasma-auto-tiler-kwin'
assert_contains "$LOADER" 'check_planner_absent'
assert_contains "$LOADER" 'check_planner_present_owner'
assert_contains "$LOADER" 'loadScript ss "$START_BUNDLE" "$PLUGIN"'
assert_contains "$LOADER" '/Scripting/Script$SCRIPT_ID'
assert_contains "$LOADER" 'unloadScript s "$PLUGIN"'
assert_contains "$LOADER" 'unloadScript s "$RECEIPT_PLUGIN"'
assert_contains "$LOADER" 'preflight-source-only'
assert_contains "$LOADER" 'prove_sources_shape_only'
assert_contains "$LOADER" 'cmd_preflight_source_only'
# Advisory route unchanged: exact advisory wording retained.
assert_contains "$LOADER" 'advisory entry source'
assert_contains "$LOADER" 'advisory query source'
assert_contains "$LOADER" 'bundle lacks the embedded query source binding'
assert_contains "$LOADER" 'must match [A-Za-z0-9._:-]{1,512}'
assert_contains "$LOADER" 'could-execute with after true requires a receipt'
assert_contains "$LOADER" 'must be loaded before advisory start'
assert_contains "$LOADER" 'must be loaded before advisory preflight'
# Shadow shape gate keeps native breadth with a source-aware comment exemption.
assert_contains "$LOADER" '"geometry"'
assert_contains "$LOADER" '"apply"'

# Determinism: real shadow builder with identity-only input.
NONCE="$(printf '%s-%s-%s' "$RANDOM" "$$" "$(date +%s%N)" | sha256sum | cut -d' ' -f1 | head -c 64)"
SBUNDLE="$REPO_ROOT/kwin/dist/shadow-describe.js"
SMANIFEST="$REPO_ROOT/kwin/dist/shadow-describe.manifest.json"
NONCE="$NONCE" node -e '
const r = { nonce: process.env.NONCE, correlationId: process.env.NONCE, owner: "shadow-test-owner", generation: "shadow-test-gen", revision: 7 };
require("node:fs").writeFileSync(process.argv[1], JSON.stringify(r));
' "$TMP_DIR/shadow-request.json"
if node "$SHADOW_BUILDER" --input "$TMP_DIR/shadow-request.json" --out "$SBUNDLE" >/dev/null 2>&1; then
  pass "shadow builder emits the fixed bundle"
else
  fail "shadow builder emits the fixed bundle"
fi
SHA_ONE="$(sha256sum -- "$SBUNDLE" | cut -d' ' -f1)"
if node "$SHADOW_BUILDER" --input "$TMP_DIR/shadow-request.json" --out "$SBUNDLE" >/dev/null 2>&1; then
  pass "shadow builder rebuilds"
else
  fail "shadow builder rebuilds"
fi
SHA_TWO="$(sha256sum -- "$SBUNDLE" | cut -d' ' -f1)"
if [[ "$SHA_ONE" == "$SHA_TWO" ]]; then pass "shadow deterministic same-input bytes"; else fail "shadow deterministic same-input bytes"; fi
if head -c 60 -- "$SBUNDLE" | grep -qF '(() =>'; then pass "shadow bundle is an IIFE"; else fail "shadow bundle is an IIFE"; fi
if grep -Eq -- '^import |^export ' "$SBUNDLE"; then fail "shadow bundle carries no ESM"; else pass "shadow bundle carries no ESM"; fi
if grep -qF -- 'sourceMappingURL' "$SBUNDLE"; then fail "shadow bundle carries no source map"; else pass "shadow bundle carries no source map"; fi
assert_contains "$SBUNDLE" 'ShadowProjection'
assert_contains "$SBUNDLE" 'shadow-describe-ready'
assert_contains "$SBUNDLE" 'shadow-describe-result'
assert_contains "$SBUNDLE" 'SHADOW_DESCRIBE_RESULT_SCHEMA'
if grep -qF -- 'advisory-describe-ready' "$SBUNDLE"; then fail "shadow bundle carries no advisory marker"; else pass "shadow bundle carries no advisory marker"; fi
if grep -qF -- 'DescribeAdvisoryPlan' "$SBUNDLE"; then fail "shadow bundle carries no advisory method"; else pass "shadow bundle carries no advisory method"; fi
if grep -qE -- '"schema":"shadow-describe-manifest-v1"' "$SMANIFEST"; then pass "shadow manifest schema"; else fail "shadow manifest schema"; fi
if grep -qF -- '"shadowSha256":"' "$SMANIFEST" && grep -qF -- "\"nonce\":\"$NONCE\"" "$SMANIFEST"; then pass "shadow manifest binds identity"; else fail "shadow manifest binds identity"; fi
if grep -qF -- '"querySha256"' "$SMANIFEST"; then fail "shadow manifest carries no query key"; else pass "shadow manifest carries no query key"; fi
if node "$SHADOW_BUILDER" --verify --input "$TMP_DIR/shadow-request.json" --bundle "$SBUNDLE" --manifest "$SMANIFEST" >/dev/null 2>&1; then
  pass "shadow verify accepts the deterministic build"
else
  fail "shadow verify accepts the deterministic build"
fi
# Identity-only input: advisory-shaped record rejected in shadow mode.
NONCE="$NONCE" node -e '
const r = { nonce: process.env.NONCE, correlationId: process.env.NONCE, owner: "o", generation: "g", revision: 1, snapshot: {}, intent: {}, capabilities: {} };
require("node:fs").writeFileSync(process.argv[1], JSON.stringify(r));
' "$TMP_DIR/shadow-bad.json"
if node "$SHADOW_BUILDER" --input "$TMP_DIR/shadow-bad.json" --out "$SBUNDLE" >/dev/null 2>&1; then fail "shadow builder rejects advisory-shaped input"; else pass "shadow builder rejects advisory-shaped input"; fi
# Advisory default unchanged: advisory record still builds advisory bundle.
NONCEA="$(printf '%s-%s-%s' "$RANDOM" "$$" "$(date +%s%N)" | sha256sum | cut -d' ' -f1 | head -c 64)"
ABUNDLE="$REPO_ROOT/kwin/dist/advisory-describe.js"
AMANIFEST="$REPO_ROOT/kwin/dist/advisory-describe.manifest.json"
NONCE="$NONCEA" node -e '
const record = { nonce: process.env.NONCE, correlationId: process.env.NONCE, owner: "adv-owner", generation: "adv-gen", revision: 7,
  snapshot: { outputs: [], windows: [] }, intent: { source_output: "s", focused_leaf: "A", focused_window: "w", direction: "down" },
  capabilities: { swap_neighbor: true } };
require("node:fs").writeFileSync(process.argv[1], JSON.stringify(record));
' "$TMP_DIR/advisory-request.json"
if node "$BUILDER" --input "$TMP_DIR/advisory-request.json" --out "$ABUNDLE" >/dev/null 2>&1; then
  pass "advisory default still builds"
else
  fail "advisory default still builds"
fi
if grep -qF -- 'DescribeAdvisoryPlan' "$ABUNDLE" && grep -qF -- 'advisory-describe-ready' "$ABUNDLE"; then
  pass "advisory bundle keeps advisory markers"
else
  fail "advisory bundle keeps advisory markers"
fi
if grep -qF -- 'shadow-describe-ready' "$ABUNDLE"; then fail "advisory bundle carries no shadow marker"; else pass "advisory bundle carries no shadow marker"; fi
# Advisory builder wording unchanged in advisory mode.
if grep -qF -- 'exact advisory keys' "$BUILDER"; then pass "advisory builder keeps advisory wording"; else fail "advisory builder keeps advisory wording"; fi
if grep -qF -- 'exactly the advisory request keys' "$BUILDER"; then pass "advisory builder keeps advisory keys wording"; else fail "advisory builder keeps advisory keys wording"; fi
if grep -qF -- 'lost the query source binding' "$BUILDER"; then pass "advisory builder keeps query binding wording"; else fail "advisory builder keeps query binding wording"; fi
if grep -qF -- 'query source does not match' "$BUILDER"; then pass "advisory builder keeps query source wording"; else fail "advisory builder keeps query source wording"; fi
rm -f -- "$ABUNDLE" "$AMANIFEST" "$SBUNDLE" "$SMANIFEST"

# Fake busctl for lifecycle-level tests: KWin + Planner identity only.
cat > "$FAKE_BIN/fake-busctl" <<'FAKE_BUSCTL'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_DIR/busctl.log"
if [[ "$*" == *NameHasOwner* && "$*" == *":1.77"* ]]; then
  if [[ "${FAKE_OWNER_LOSS_BUS_FAILURE:-0}" == "1" ]]; then
    echo "fake busctl: unique-owner transport failure" >&2
    exit 2
  fi
  if [[ -f "$FAKE_DIR/planner-alive" ]]; then printf '{"type":"b","data":[true]}'; else printf '{"type":"b","data":[false]}'; fi
  exit 0
fi
if [[ "$*" == *NameHasOwner* && "$*" == *"org.plasmaautotiler.Planner"* ]]; then
  if [[ -f "$FAKE_DIR/planner-alive" ]]; then printf '{"type":"b","data":[true]}'; else printf '{"type":"b","data":[false]}'; fi
  exit 0
fi
if [[ "$*" == *ListNames* ]]; then
  echo "fake busctl: ListNames enumeration is forbidden (exact owner query only)" >&2
  exit 1
fi
if [[ "$*" == *GetNameOwner* && "$*" == *"org.plasmaautotiler.Planner"* ]]; then
  if [[ -s "$FAKE_DIR/planner-owner-seq" ]]; then
    line="$(head -n 1 -- "$FAKE_DIR/planner-owner-seq")"
    tail -n +2 -- "$FAKE_DIR/planner-owner-seq" > "$FAKE_DIR/planner-owner-seq.tmp" 2>/dev/null || true
    mv -- "$FAKE_DIR/planner-owner-seq.tmp" "$FAKE_DIR/planner-owner-seq" 2>/dev/null || true
    printf '{"type":"s","data":["%s"]}' "$line"
    exit 0
  fi
  if [[ -f "$FAKE_DIR/planner-alive" ]]; then printf '{"type":"s","data":[":1.77"]}'; exit 0; fi
  echo "fake busctl: planner has no owner" >&2
  exit 1
fi
if [[ "$*" == *GetNameOwner* && "$*" == *"org.kde.KWin"* ]]; then
  printf '{"type":"s","data":[":1.10"]}'
  exit 0
fi
if [[ "$*" == *GetConnectionUnixProcessID* ]]; then
  last="${*: -1}"
  if [[ "$last" == ":1.77" ]]; then
    if [[ -s "$FAKE_DIR/planner-pid-seq" ]]; then
      line="$(head -n 1 -- "$FAKE_DIR/planner-pid-seq")"
      tail -n +2 -- "$FAKE_DIR/planner-pid-seq" > "$FAKE_DIR/planner-pid-seq.tmp" 2>/dev/null || true
      mv -- "$FAKE_DIR/planner-pid-seq.tmp" "$FAKE_DIR/planner-pid-seq" 2>/dev/null || true
      if [[ "$line" == "ALIVE" ]]; then line="$(cat -- "$FAKE_DIR/planner-alive")"; fi
      printf '{"type":"u","data":[%s]}' "$line"
      exit 0
    fi
    [[ -f "$FAKE_DIR/planner-alive" ]] || { echo "fake busctl: planner owner absent" >&2; exit 1; }
    printf '{"type":"u","data":[%s]}' "$(cat -- "$FAKE_DIR/planner-alive")"
    exit 0
  fi
  if [[ "$last" == ":1.10" ]]; then
    printf '{"type":"u","data":[%s]}' "$(cat -- "$FAKE_DIR/kwin-pid")"
    exit 0
  fi
  echo "fake busctl: unknown owner $last" >&2
  exit 1
fi
echo "fake busctl: unexpected call: $*" >&2
exit 1
FAKE_BUSCTL
chmod +x -- "$FAKE_BIN/fake-busctl"

# Fake builder: deterministic shadow bundle plus single-line manifest.
cat > "$FAKE_BIN/fake-builder" <<'FAKE_BUILDER'
#!/usr/bin/env node
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const fakeDir = process.env.FAKE_DIR;
const args = process.argv.slice(2);
const get = (f) => {
  const i = args.indexOf(f);
  if (i < 0 || i + 1 >= args.length) { console.error(`missing ${f}`); process.exit(1); }
  return args[i + 1];
};
const has = (f) => args.includes(f);
if (has("--verify")) {
  console.log("fake-builder: verify ok");
  process.exit(0);
}
const input = get("--input");
const out = get("--out");
if (path.basename(out) !== "shadow-describe.js") { console.error("fake builder: fixed shadow bundle only"); process.exit(1); }
const raw = fs.readFileSync(input);
const record = JSON.parse(raw.toString("utf8"));
if (Object.keys(record).length !== 5 || !record.nonce || record.correlationId !== record.nonce) {
  console.error("fake builder: identity-only input only");
  process.exit(1);
}
const inputSha = crypto.createHash("sha256").update(raw).digest("hex");
const bundleText = `fake-shadow-bundle ${inputSha} ShadowProjection shadow-describe-ready shadow-describe-result\n`;
fs.writeFileSync(out, bundleText);
const bundleSha = crypto.createHash("sha256").update(bundleText).digest("hex");
const manifest = { schema: "shadow-describe-manifest-v1", bundle: "shadow-describe.js", bundleSha256: bundleSha,
  entry: "shadow-describe-entry.ts", entrySha256: "e".repeat(64), shadow: "advisory-shadow-projection.ts", shadowSha256: "f".repeat(64),
  snapshot: "advisory-snapshot.ts", snapshotSha256: "a".repeat(64), nonce: record.nonce, correlationId: record.correlationId,
  owner: record.owner, generation: record.generation, revision: record.revision, inputSha256: inputSha };
fs.writeFileSync(path.join(path.dirname(out), "shadow-describe.manifest.json"), JSON.stringify(manifest) + "\n");
fs.appendFileSync(path.join(fakeDir, "builder.log"), `build correlation=${record.correlationId} out=${out}\n`);
console.log("fake-builder: wrote shadow bundle");
FAKE_BUILDER
chmod +x -- "$FAKE_BIN/fake-builder"

# Fake planner: single child plus proc fixture.
cat > "$FAKE_BIN/fake-planner" <<'FAKE_PLANNER'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_DIR/planner-argv.log"
if [[ "$*" != *"planner-service"* ]]; then echo "fake planner: exact planner-service only" >&2; exit 1; fi
if [[ "$*" == *"--advisory-loss-correlation"* ]]; then echo "fake planner: shadow takes no loss flag" >&2; exit 1; fi
mode="${PLANNER_FAKE_MODE:-normal}"
if [[ "$mode" == "exit-fast" ]]; then echo "fake planner: immediate exit" >&2; exit 1; fi
printf '%s\n' "$$" > "$FAKE_DIR/planner-alive"
tick="${PLANNER_FAKE_TICK:-777001}"
mkdir -p -- "$PROC_ROOT/$$"
printf '%s (fake-planner) S 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 %s\n' "$$" "$tick" > "$PROC_ROOT/$$/stat"
rm -f -- "$PROC_ROOT/$$/exe"
ln -s -- "$(readlink -f -- "$0")" "$PROC_ROOT/$$/exe"
cleanup_stub() { kill -- "$SLEEP_PID" 2>/dev/null || true; rm -f -- "$FAKE_DIR/planner-alive"; rm -rf -- "$PROC_ROOT/$$"; exit 0; }
trap cleanup_stub TERM INT
sleep 30 & SLEEP_PID=$!
wait $SLEEP_PID
FAKE_PLANNER
chmod +x -- "$FAKE_BIN/fake-planner"

# Fake loader: preflight/start/stop/diagnostics with shadow markers.
cat > "$FAKE_BIN/fake-loader" <<'FAKE_LOADER'
#!/usr/bin/env bash
cmd="${1:-}"
shift || true
printf '%s %s\n' "$cmd" "$*" >> "$FAKE_DIR/loader-calls.log"
mfield() { sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" "$1" | head -n 1; }
nfield() { sed -n "s/.*\"$2\":\([0-9][0-9]*\).*/\1/p" "$1" | head -n 1; }
case "$cmd" in
  preflight-source-only)
    if [[ $# -ne 0 ]]; then echo "fake loader: preflight-source-only takes no arguments" >&2; exit 1; fi
    if [[ -f "$FAKE_DIR/loader-source-preflight-fail" ]]; then echo "fake loader: source-only preflight refused" >&2; exit 1; fi
    printf 'preflight-source-only: entry=fake query=fake snapshot=fake\n'
    exit 0
    ;;
  preflight)
    bundle=""; manifest=""; input=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --bundle) bundle="$2"; shift 2 ;;
        --manifest) manifest="$2"; shift 2 ;;
        --input) input="$2"; shift 2 ;;
        --expected-planner-owner) shift 2 ;;
        *) echo "fake loader: unknown preflight flag $1" >&2; exit 1 ;;
      esac
    done
    if [[ -f "$FAKE_DIR/loader-preflight-fail" ]]; then echo "fake loader: preflight refused" >&2; exit 1; fi
    if [[ "$bundle" != *"shadow-describe.js" || "$manifest" != *"shadow-describe.manifest.json" ]]; then
      echo "fake loader: fixed shadow bundle/manifest only" >&2; exit 1
    fi
    corr="$(mfield "$manifest" correlationId)"
    printf 'preflight: bundle=fake entry=fake shadow=fake snapshot=fake input=fake owner=fake generation=fake revision=0 correlation=%s nonce=%s\n' "$corr" "$corr"
    exit 0
    ;;
  start)
    bundle=""; manifest=""; receipt=""; diag=""; input=""; exp_owner=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --bundle) bundle="$2"; shift 2 ;;
        --manifest) manifest="$2"; shift 2 ;;
        --receipt) receipt="$2"; shift 2 ;;
        --diag-file) diag="$2"; shift 2 ;;
        --input) input="$2"; shift 2 ;;
        --attempts) shift 2 ;;
        --delay) shift 2 ;;
        --expected-planner-owner) exp_owner="$2"; shift 2 ;;
        *) echo "fake loader: unknown start flag $1" >&2; exit 1 ;;
      esac
    done
    if [[ -z "$exp_owner" ]]; then echo "fake loader: pinned planner owner required" >&2; exit 1; fi
    if [[ "$exp_owner" != ":1.77" ]]; then echo "fake loader: planner owner mismatch" >&2; exit 1; fi
    behavior="default"
    if [[ -s "$FAKE_DIR/loader-start-seq" ]]; then
      behavior="$(head -n 1 -- "$FAKE_DIR/loader-start-seq")"
      tail -n +2 -- "$FAKE_DIR/loader-start-seq" > "$FAKE_DIR/loader-start-seq.tmp" 2>/dev/null || true
      mv -- "$FAKE_DIR/loader-start-seq.tmp" "$FAKE_DIR/loader-start-seq" 2>/dev/null || true
    fi
    corr="$(mfield "$manifest" correlationId)"
    if [[ "$behavior" == fail:* ]]; then echo "fake loader: ${behavior#fail:}" >&2; exit 1; fi
    if [[ "$behavior" == "divergence" ]]; then detail="divergence"; else detail="match"; fi
    if [[ "$behavior" == ok-receipt:* ]]; then n="${behavior#ok-receipt:}"; else n="0"; fi
    if [[ "$behavior" == "refuse-stale" ]]; then
      printf 'refused: plugin=fake script=3 object=/Scripting/Script3 correlation=%s detail=reject:shadow-stale-snapshot after=false\n' "$corr"
      exit 0
    fi
    printf 'plasma-auto-tiler:shadow-describe-source:%s:%s:%s\nplasma-auto-tiler:shadow-describe-ready:%s\nplasma-auto-tiler:shadow-describe-result:v1:%s:shadow-lifecycle-owner:shadow-lifecycle-gen:7:%s:%s\nplasma-auto-tiler:shadow-describe-after:v1:%s:true\n' \
      "e" "f" "a" "$corr" "$corr" "$corr" "$detail" "$corr" >> "$diag"
    printf '{"schema":"fake","scriptId":%s}\n' "$n" > "$receipt"
    printf 'receipt-id=%s correlation=%s detail=%s after=true owner=%s\n' "$n" "$corr" "$detail" "$exp_owner" >> "$FAKE_DIR/loader-calls.log"
    printf 'started: plugin=fake script=%s object=/Scripting/Script%s correlation=%s owner=%s\n' "$n" "$n" "$corr" "$exp_owner"
    exit 0
    ;;
  stop)
    receipt=""
    while [[ $# -gt 0 ]]; do case "$1" in --receipt) receipt="$2"; shift 2 ;; *) echo "fake loader: unknown stop flag" >&2; exit 1 ;; esac; done
    rm -f -- "$receipt"
    printf 'stopped: plugin=fake cleanup=verified\n'
    exit 0
    ;;
  diagnostics)
    printf 'diagnostics: markers=correlated\n'
    exit 0
    ;;
  *) echo "fake loader: unknown command $cmd" >&2; exit 1 ;;
esac
FAKE_LOADER
chmod +x -- "$FAKE_BIN/fake-loader"

KWIN_PID="4242"
KWIN_TICK="424200"
printf '%s\n' "$KWIN_PID" > "$TMP_DIR/kwin-pid"
mkdir -p -- "$FAKE_PROC/$KWIN_PID"
printf '%s (kwin_wayland) S 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 %s\n' "$KWIN_PID" "$KWIN_TICK" > "$FAKE_PROC/$KWIN_PID/stat"
printf 'kwin-fixture\n' > "$TMP_DIR/kwin-exe"
chmod 555 -- "$TMP_DIR/kwin-exe"
rm -f -- "$FAKE_PROC/$KWIN_PID/exe"
ln -s -- "$TMP_DIR/kwin-exe" "$FAKE_PROC/$KWIN_PID/exe"

life_env() {
  export SHADOW_LIFECYCLE_ALLOW=1
  export SHADOW_LIFECYCLE_TEST_FAKE=1
  export SHADOW_LOADER="$FAKE_BIN/fake-loader"
  export SHADOW_BUILDER="$FAKE_BIN/fake-builder"
  export SHADOW_DIST_DIR="$FAKE_DIST"
  export PLANNER_BIN="$FAKE_BIN/fake-planner"
  export BUSCTL_BIN="$FAKE_BIN/fake-busctl"
  export PROC_ROOT="$FAKE_PROC"
  export FAKE_DIR
  export REPO_ROOT
  export TMPDIR="$FAKE_TMP"
  export SHADOW_ATTEMPTS=5
  export SHADOW_DELAY=0.01
  export SHADOW_STOP_ATTEMPTS=20
  export PLANNER_FAKE_MODE=normal
  export PLANNER_FAKE_TICK=777001
  export FAKE_OWNER_LOSS_BUS_FAILURE=0
  unset SHADOW_LIFECYCLE_TEST_HOOK_AFTER_PIN SHADOW_LIFECYCLE_TEST_HOOK_BEFORE_STOP
}

reset_fake() {
  rm -f -- "$FAKE_DIR"/loader-calls.log "$FAKE_DIR"/builder.log "$FAKE_DIR"/busctl.log
  rm -f -- "$FAKE_DIR"/planner-argv.log "$FAKE_DIR"/planner-alive "$FAKE_DIR"/follower-pids.log
  rm -f -- "$FAKE_DIR"/loader-start-seq "$FAKE_DIR"/loader-preflight-fail "$FAKE_DIR"/loader-source-preflight-fail
  printf '%s\n' "$KWIN_PID" > "$FAKE_DIR/kwin-pid"
  rm -rf -- "$FAKE_DIST" "$FAKE_TMP"
  mkdir -p -- "$FAKE_DIST" "$FAKE_TMP"
  rm -rf -- "$FAKE_PROC"
  mkdir -p -- "$FAKE_PROC/$KWIN_PID"
  printf '%s (kwin_wayland) S 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 %s\n' "$KWIN_PID" "$KWIN_TICK" > "$FAKE_PROC/$KWIN_PID/stat"
  rm -f -- "$FAKE_PROC/$KWIN_PID/exe"
  ln -s -- "$TMP_DIR/kwin-exe" "$FAKE_PROC/$KWIN_PID/exe"
  life_env
}

# Lifecycle success: one shadow journey with script id 0.
reset_fake
if "$LIFECYCLE" run > "$TMP_DIR/out-a.txt" 2> "$TMP_DIR/err-a.txt"; then
  pass "lifecycle run succeeds end to end"
else
  fail "lifecycle run succeeds end to end"
  head -n 20 -- "$TMP_DIR/err-a.txt" 2>/dev/null || true
fi
if grep -q 'phases=shadow' "$TMP_DIR/out-a.txt" && grep -q 'continuity=verified' "$TMP_DIR/out-a.txt"; then
  pass "summary reports shadow phases and continuity"
else
  fail "summary reports shadow phases and continuity"
fi
if grep -q '^preflight' "$FAKE_DIR/loader-calls.log" && grep -q '^start' "$FAKE_DIR/loader-calls.log" \
  && grep -q '^stop' "$FAKE_DIR/loader-calls.log" && grep -q 'diagnostics' "$FAKE_DIR/loader-calls.log"; then
  pass "lifecycle journey covers preflight/start/stop/diagnostics"
else
  fail "lifecycle journey covers preflight/start/stop/diagnostics"
fi
if grep -q '^preflight-source-only' "$FAKE_DIR/loader-calls.log"; then
  pass "lifecycle runs the resource-free source-only preflight first"
else
  fail "lifecycle runs the resource-free source-only preflight first"
fi
if [[ "$(grep -c '^preflight-source-only' "$FAKE_DIR/loader-calls.log")" -eq 1 && "$(grep -c '^preflight ' "$FAKE_DIR/loader-calls.log")" -ge 1 ]]; then
  pass "source-only preflight precedes the full deterministic preflight"
else
  fail "source-only preflight precedes the full deterministic preflight"
fi
if grep -q 'build correlation=' "$FAKE_DIR/builder.log"; then
  pass "builder invoked only after the source-only preflight"
else
  fail "builder invoked only after the source-only preflight"
fi
if [[ "$(grep -c '^start ' "$FAKE_DIR/loader-calls.log")" -eq 1 ]]; then
  pass "exactly one shadow transport ran once"
else
  fail "exactly one shadow transport ran once"
fi
if grep -q 'receipt-id=0' "$FAKE_DIR/loader-calls.log"; then
  pass "lifecycle accepts script id 0 when returned"
else
  fail "lifecycle accepts script id 0 when returned"
fi
if grep -q 'detail=match after=true' "$FAKE_DIR/loader-calls.log" && grep -q 'owner=:1.77' "$FAKE_DIR/loader-calls.log"; then
  pass "shadow receipt pairs match with after true under the pinned owner"
else
  fail "shadow receipt pairs match with after true under the pinned owner"
fi
if [[ "$(wc -l < "$FAKE_DIR/planner-argv.log")" -eq 1 ]] && grep -q 'planner-service' "$FAKE_DIR/planner-argv.log"; then
  pass "one exact planner child only"
else
  fail "one exact planner child only"
fi
if [[ ! -f "$FAKE_DIR/planner-alive" ]]; then
  pass "planner exactly stopped"
else
  fail "planner exactly stopped"
fi
if grep -q 'GetNameOwner.*org.plasmaautotiler.Planner' "$FAKE_DIR/busctl.log" \
  && grep -q 'GetConnectionUnixProcessID.*:1.77' "$FAKE_DIR/busctl.log" \
  && grep -q 'NameHasOwner.*:1.77' "$FAKE_DIR/busctl.log"; then
  pass "planner owner/PID pinned and exact unique-owner loss queried"
else
  fail "planner owner/PID pinned and exact unique-owner loss queried"
fi
if grep -q 'ListNames' "$FAKE_DIR/busctl.log"; then
  fail "no ListNames enumeration during unique-owner loss"
else
  pass "no ListNames enumeration during unique-owner loss"
fi
if [[ -z "$(ls -A -- "$FAKE_DIST" 2>/dev/null)" && -z "$(ls -A -- "$FAKE_TMP" 2>/dev/null)" ]]; then
  pass "dist artifacts and fresh dir removed"
else
  fail "dist artifacts and fresh dir removed"
fi

# Divergence variant pairs with after true.
reset_fake
printf 'divergence\n' > "$FAKE_DIR/loader-start-seq"
if "$LIFECYCLE" run >/dev/null 2>&1 && grep -q 'detail=divergence' "$FAKE_DIR/loader-calls.log"; then
  pass "divergence pairs with after true"
else
  fail "divergence pairs with after true"
fi

# Disabled mode and unknown command create nothing.
reset_fake
export SHADOW_LIFECYCLE_ALLOW=0
if "$LIFECYCLE" run >/dev/null 2>&1; then fail "disabled mode must refuse"; else pass "disabled mode refuses"; fi
export SHADOW_LIFECYCLE_ALLOW=1
if "$LIFECYCLE" bogus >/dev/null 2>&1; then fail "unknown command must refuse"; else pass "unknown command refuses"; fi
if "$LIFECYCLE" run extra >/dev/null 2>&1; then fail "run args must refuse"; else pass "run rejects extra args"; fi
if [[ -z "$(ls -A -- "$FAKE_TMP" 2>/dev/null)" && -z "$(ls -A -- "$FAKE_DIST" 2>/dev/null)" ]]; then
  pass "no resources on refused commands"
else
  fail "no resources on refused commands"
fi

# Source-only preflight failure creates nothing transient: no builder call,
# no bootstrap input, no dist output, no runtime dir, no planner launch.
# Proves ordering before initial failure, not merely final cleanup.
reset_fake
touch -- "$FAKE_DIR/loader-source-preflight-fail"
if "$LIFECYCLE" run >/dev/null 2>&1; then fail "source-only preflight failure must fail"; else pass "source-only preflight failure fails closed"; fi
if [[ ! -f "$FAKE_DIR/builder.log" ]]; then pass "no builder invocation before source-only failure"; else fail "no builder invocation before source-only failure"; fi
if [[ -z "$(ls -A -- "$FAKE_TMP" 2>/dev/null)" && -z "$(ls -A -- "$FAKE_DIST" 2>/dev/null)" ]]; then
  pass "no transient input/output/dir before source-only failure"
else
  fail "no transient input/output/dir before source-only failure"
fi
if [[ ! -f "$FAKE_DIR/planner-argv.log" ]]; then pass "no planner launch before source-only failure"; else fail "no planner launch before source-only failure"; fi
if grep -q '^preflight-source-only' "$FAKE_DIR/loader-calls.log" && ! grep -q '^preflight ' "$FAKE_DIR/loader-calls.log" && ! grep -q '^start' "$FAKE_DIR/loader-calls.log"; then
  pass "only the source-only preflight ran before initial failure"
else
  fail "only the source-only preflight ran before initial failure"
fi

# Missing builder fails before any lifecycle-created resource.
reset_fake
export SHADOW_BUILDER="$FAKE_BIN/missing-builder"
if "$LIFECYCLE" run >/dev/null 2>&1; then fail "missing builder must fail"; else pass "missing builder fails closed"; fi
if [[ -z "$(ls -A -- "$FAKE_TMP" 2>/dev/null)" && -z "$(ls -A -- "$FAKE_DIST" 2>/dev/null)" ]]; then
  pass "no resources when the builder is unavailable"
else
  fail "no resources when the builder is unavailable"
fi
if [[ ! -f "$FAKE_DIR/planner-argv.log" ]]; then pass "no planner launch when the builder is unavailable"; else fail "no planner launch when the builder is unavailable"; fi
life_env

# Preflight failure creates no runtime dir and cleans the bootstrap.
reset_fake
touch -- "$FAKE_DIR/loader-preflight-fail"
if "$LIFECYCLE" run >/dev/null 2>&1; then fail "preflight failure must fail"; else pass "preflight failure fails closed"; fi
if [[ -z "$(ls -A -- "$FAKE_TMP" 2>/dev/null)" && -z "$(ls -A -- "$FAKE_DIST" 2>/dev/null)" ]]; then
  pass "no fresh dir after preflight failure"
else
  fail "no fresh dir after preflight failure"
fi
if [[ ! -f "$FAKE_DIR/planner-argv.log" ]]; then pass "no planner launch after preflight failure"; else fail "no planner launch after preflight failure"; fi

# Planner collision refuses before any launch.
reset_fake
printf '999999\n' > "$FAKE_DIR/planner-alive"
if "$LIFECYCLE" run >/dev/null 2>&1; then fail "collision must refuse"; else pass "collision refuses"; fi
if [[ ! -f "$FAKE_DIR/planner-argv.log" ]]; then pass "no child on collision"; else fail "no child on collision"; fi

# Planner launch failure (immediate exit, no restart).
reset_fake
export PLANNER_FAKE_MODE=exit-fast
if "$LIFECYCLE" run >/dev/null 2>&1; then fail "launch failure must fail"; else pass "launch failure fails closed"; fi
if [[ -z "$(ls -A -- "$FAKE_TMP" 2>/dev/null)" ]]; then pass "fresh dir removed on launch failure"; else fail "fresh dir removed on launch failure"; fi
export PLANNER_FAKE_MODE=normal

# Owner and PID drift fail closed.
reset_fake
printf ':1.77\n:1.78\n' > "$FAKE_DIR/planner-owner-seq"
if "$LIFECYCLE" run >/dev/null 2>&1; then fail "owner drift must fail"; else pass "owner drift fails closed"; fi
reset_fake
printf 'ALIVE\n999999\n' > "$FAKE_DIR/planner-pid-seq"
if "$LIFECYCLE" run >/dev/null 2>&1; then fail "PID drift must fail"; else pass "PID drift fails closed"; fi

# Tick and exe drift preserve the exact residue.
reset_fake
cat > "$TMP_DIR/hook-tick.sh" <<'HOOK'
#!/usr/bin/env bash
pid="$(cat -- "$FAKE_DIR/planner-alive")"
printf '%s (fake-planner) S 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 888002\n' "$pid" > "$PROC_ROOT/$pid/stat"
HOOK
chmod +x -- "$TMP_DIR/hook-tick.sh"
export SHADOW_LIFECYCLE_TEST_HOOK_AFTER_PIN="$TMP_DIR/hook-tick.sh"
if "$LIFECYCLE" run >/dev/null 2>&1; then fail "tick drift must fail"; else pass "tick drift fails closed"; fi
if ls -d -- "$FAKE_TMP"/shadow-transport-* >/dev/null 2>&1; then
  pass "tick drift preserves the exact residue"
else
  fail "tick drift preserves the exact residue"
fi
kill -TERM -- "$(cat -- "$FAKE_DIR/planner-alive" 2>/dev/null)" 2>/dev/null || true
sleep 0.2
reset_fake
printf 'hook-exe\n' > "$TMP_DIR/other-exe"
chmod 555 -- "$TMP_DIR/other-exe"
cat > "$TMP_DIR/hook-exe.sh" <<'HOOK'
#!/usr/bin/env bash
pid="$(cat -- "$FAKE_DIR/planner-alive")"
rm -f -- "$PROC_ROOT/$pid/exe"
ln -s -- "$TMP_DIR/other-exe" "$PROC_ROOT/$pid/exe"
HOOK
chmod +x -- "$TMP_DIR/hook-exe.sh"
export SHADOW_LIFECYCLE_TEST_HOOK_AFTER_PIN="$TMP_DIR/hook-exe.sh"
if "$LIFECYCLE" run >/dev/null 2>&1; then fail "exe drift must fail"; else pass "exe drift fails closed"; fi
if ls -d -- "$FAKE_TMP"/shadow-transport-* >/dev/null 2>&1; then
  pass "exe drift preserves the exact residue"
else
  fail "exe drift preserves the exact residue"
fi
kill -TERM -- "$(cat -- "$FAKE_DIR/planner-alive" 2>/dev/null)" 2>/dev/null || true
sleep 0.2
unset SHADOW_LIFECYCLE_TEST_HOOK_AFTER_PIN

# Unique-owner transport failure is not loss evidence; exact-cleans.
reset_fake
export FAKE_OWNER_LOSS_BUS_FAILURE=1
if "$LIFECYCLE" run >/dev/null 2>&1; then fail "unique-owner transport failure must refuse"; else pass "unique-owner transport failure refuses"; fi
if [[ ! -f "$FAKE_DIR/planner-alive" && -z "$(ls -A -- "$FAKE_TMP" 2>/dev/null)" ]]; then
  pass "unique-owner transport failure exact-cleans"
else
  fail "unique-owner transport failure exact-cleans"
fi
export FAKE_OWNER_LOSS_BUS_FAILURE=0

# Build output collision refuses without overwriting.
reset_fake
printf 'preserve\n' > "$FAKE_DIST/shadow-describe.js"
if "$LIFECYCLE" run >/dev/null 2>&1; then fail "build output collision must refuse"; else pass "build output collision refuses"; fi
if [[ "$(<"$FAKE_DIST/shadow-describe.js")" == "preserve" && ! -f "$FAKE_DIR/planner-argv.log" ]]; then
  pass "build output collision preserves exact prior output"
else
  fail "build output collision preserves exact prior output"
fi

# Loader failure cleans everything (partial cleanup through known IDs).
reset_fake
printf 'fail:shadow transport broke\n' > "$FAKE_DIR/loader-start-seq"
if "$LIFECYCLE" run >/dev/null 2>&1; then fail "loader failure must fail"; else pass "loader failure fails closed"; fi
if [[ ! -f "$FAKE_DIR/planner-alive" && -z "$(ls -A -- "$FAKE_TMP" 2>/dev/null)" && -z "$(ls -A -- "$FAKE_DIST" 2>/dev/null)" ]]; then
  pass "loader failure cleans everything"
else
  fail "loader failure cleans everything"
fi

# Observability: bounded redacted invocation-tied diags before cleanup.
reset_fake
if "$LIFECYCLE" run > "$TMP_DIR/out-s.txt" 2> "$TMP_DIR/err-s.txt"; then
  pass "observability success run completes"
else
  fail "observability success run completes"
fi
for _inv in "preflight:source-only" "build:bootstrap" "verify:bootstrap" "loader-start:shadow" "loader-diagnostics:shadow" "loader-stop:shadow"; do
  if grep -qF "diag: invocation=$_inv exit=0" "$TMP_DIR/err-s.txt"; then
    pass "success diag present: $_inv exit=0"
  else
    fail "success diag present: $_inv exit=0"
  fi
done
if grep -qF ':1.77' "$TMP_DIR/err-s.txt" || grep -qF ':1.10' "$TMP_DIR/err-s.txt"; then
  fail "success diags leak no native bus IDs"
else
  pass "success diags leak no native bus IDs"
fi

# Real-loader exact lifecycle through the thin shadow wrapper (fake bus only).
# Proves the shared primitives: signed ID incl 0, exact Script object only,
# correlated bounded source/ready/result/after with match|divergence + true,
# exact unload/stop, production isolation, bounded parser.
REAL_BIN="$TMP_DIR/realbin"
REAL_FAKE="$TMP_DIR/realfake"
export REAL_FAKE
mkdir -p -- "$REAL_BIN" "$REAL_FAKE"
cat > "$REAL_BIN/busctl" <<'FAKE_BUSCTL2'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$REAL_FAKE/calls.log"
if printf '%s' "$*" | grep -Fq 'unloadScript'; then
  cat -- "$REAL_FAKE/unload_reply"
  exit "${FAKE_UNLOAD_EXIT:-0}"
fi
if printf '%s' "$*" | grep -Fq 'loadScript'; then
  cat -- "$REAL_FAKE/load_reply"
  exit "${FAKE_LOAD_EXIT:-0}"
fi
if [[ "${1:-}" == "--user" && "${2:-}" == "introspect" ]]; then
  cat -- "$REAL_FAKE/introspect_reply"
  exit "${FAKE_INTROSPECT_EXIT:-0}"
fi
if [[ "${1:-}" == "introspect" ]]; then echo "fake busctl: unscoped introspect" >&2; exit 1; fi
if printf '%s' "$*" | grep -Fq 'NameHasOwner'; then
  if printf '%s' "$*" | grep -Fq 'org.plasmaautotiler.Planner'; then
    if [[ -f "$REAL_FAKE/planner-owner" ]]; then printf '{"type":"b","data":[true]}'; exit 0; fi
    printf '{"type":"b","data":[false]}'
    exit 0
  fi
fi
if printf '%s' "$*" | grep -Fq 'GetNameOwner'; then
  if printf '%s' "$*" | grep -Fq 'org.plasmaautotiler.Planner'; then
    if [[ -f "$REAL_FAKE/planner-owner" ]]; then
      printf '{"type":"s","data":["%s"]}' "$(cat -- "$REAL_FAKE/planner-owner")"; exit 0
    fi
    echo "fake busctl: planner has no owner" >&2; exit 1
  fi
  if printf '%s' "$*" | grep -Fq 'org.kde.KWin'; then
    printf '{"type":"s","data":["%s"]}' "$(cat -- "$REAL_FAKE/kwin-owner")"; exit 0
  fi
fi
if printf '%s' "$*" | grep -Fq 'GetConnectionUnixProcessID'; then
  last="${*: -1}"
  if [[ "$last" == :* && "$last" != "$(cat -- "$REAL_FAKE/kwin-owner")" ]]; then
    printf '{"type":"u","data":[%s]}' "$(cat -- "$REAL_FAKE/planner-pid")"; exit 0
  fi
  printf '{"type":"u","data":[%s]}' "$(cat -- "$REAL_FAKE/kwin-pid")"
  exit 0
fi
if printf '%s' "$*" | grep -Fq 'isScriptLoaded'; then
  if printf '%s' "$*" | grep -Fq 'plasma-auto-tiler-kwin'; then cat -- "$REAL_FAKE/prod_reply"; exit 0; fi
  if [[ -f "$REAL_FAKE/is_loaded_queue" && -s "$REAL_FAKE/is_loaded_queue" ]]; then
    line="$(head -n 1 -- "$REAL_FAKE/is_loaded_queue")"
    tail -n +2 -- "$REAL_FAKE/is_loaded_queue" > "$REAL_FAKE/is_loaded_queue.tmp" 2>/dev/null || true
    mv -- "$REAL_FAKE/is_loaded_queue.tmp" "$REAL_FAKE/is_loaded_queue" 2>/dev/null || true
    printf '%s' "$line"; exit 0
  fi
  cat -- "$REAL_FAKE/is_loaded_reply"; exit 0
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
if [[ "${*: -1}" == "stop" ]]; then exit "${FAKE_STOP_EXIT:-0}"; fi
exit 1
FAKE_BUSCTL2
chmod +x -- "$REAL_BIN/busctl"
cat > "$REAL_BIN/systemctl" <<'FAKE_SYSTEMCTL2'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$REAL_FAKE/systemctl.log"
[[ -f "$REAL_FAKE/systemctl-show" ]] || { echo "fake systemctl: unit unavailable" >&2; exit 1; }
cat -- "$REAL_FAKE/systemctl-show"
FAKE_SYSTEMCTL2
chmod +x -- "$REAL_BIN/systemctl"
REAL_NODE="$(command -v node)"
cat > "$REAL_BIN/node" <<FAKE_NODE2
#!/usr/bin/env bash
exec "$REAL_NODE" "\$@"
FAKE_NODE2
chmod +x -- "$REAL_BIN/node"

export BUSCTL_BIN="$REAL_BIN/busctl"
export SYSTEMCTL_BIN="$REAL_BIN/systemctl"
export NODE_BIN="$REAL_BIN/node"
export FAKE_DIAG="$TMP_DIR/real-diag.log"
export FAKE_APPEND=1
REAL_PKG="$TMP_DIR/real-pkg"
REAL_LAUNCHER="$REAL_PKG/bin/kwin_wayland_wrapper"
REAL_WRAPPED="$REAL_PKG/bin/.kwin_wayland_wrapper-wrapped"
REAL_PROC="$TMP_DIR/real-proc"
export PROC_ROOT="$REAL_PROC"
export POC3_KWIN_IDENTITY_TEST_ALLOW_NONPROC=1
export POC3_KWIN_IDENTITY_TEST_ALLOW_NONSTORE=1
mkdir -p -- "$REAL_PKG/bin" "$REAL_PROC/sys/kernel/random"
printf 'launcher-fixture\n' > "$REAL_LAUNCHER"; chmod 555 -- "$REAL_LAUNCHER"
printf 'wrapped-fixture\n' > "$REAL_WRAPPED"; chmod 555 -- "$REAL_WRAPPED"
printf '12345678-1234-1234-1234-123456789abc\n' > "$REAL_PROC/sys/kernel/random/boot_id"
printf ':1.10\n' > "$REAL_FAKE/kwin-owner"
printf '4242\n' > "$REAL_FAKE/kwin-pid"
mkdir -p -- "$REAL_PROC/4242"
printf '%s (kwin_wayland) S 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 %s\n' "4242" "424200" > "$REAL_PROC/4242/stat"
rm -f -- "$REAL_PROC/4242/exe"; ln -s -- "$REAL_WRAPPED" "$REAL_PROC/4242/exe"
printf '0::/\n' > "$REAL_PROC/4242/cgroup"
cat > "$REAL_FAKE/systemctl-show" <<EOF
Id=plasma-kwin_wayland.service
ActiveState=active
SubState=running
MainPID=4242
Type=dbus
BusName=org.kde.KWinWrapper
ExecStart={ path=$REAL_LAUNCHER ; argv[]=$REAL_LAUNCHER --socket test ; ignore=no }
FragmentPath=/run/systemd/user/plasma-kwin_wayland.service
SourcePath=
EOF

real_env() {
  export BUSCTL_BIN="$REAL_BIN/busctl"
  export SYSTEMCTL_BIN="$REAL_BIN/systemctl"
  export NODE_BIN="$REAL_BIN/node"
  export PROC_ROOT="$REAL_PROC"
  export POC3_KWIN_IDENTITY_TEST_ALLOW_NONPROC=1
  export POC3_KWIN_IDENTITY_TEST_ALLOW_NONSTORE=1
  export REAL_FAKE
  # Undo lifecycle-section overrides so the real fixture build and the real
  # loader below use exact repo paths, never test fakes.
  SHADOW_LOADER="$WRAPPER"
  SHADOW_BUILDER="$SHADOW_BUILDER_REAL"
  SHADOW_DIST_DIR="$REPO_ROOT/kwin/dist"
  PLANNER_BIN=""
  export SHADOW_LOADER SHADOW_BUILDER SHADOW_DIST_DIR PLANNER_BIN
  unset SHADOW_LIFECYCLE_TEST_HOOK_AFTER_PIN SHADOW_LIFECYCLE_TEST_HOOK_BEFORE_STOP
  unset SHADOW_LIFECYCLE_ALLOW SHADOW_LIFECYCLE_TEST_FAKE
}

real_reset() {
  real_env
  rm -f -- "$REAL_FAKE/calls.log" "$REAL_FAKE/is_loaded_queue" "$REAL_FAKE/planner-owner" "$REAL_FAKE/planner-pid"
  : > "$REAL_FAKE/calls.log"
  printf 'i 3' > "$REAL_FAKE/load_reply"
  printf 'interface org.kde.kwin.Script { };' > "$REAL_FAKE/introspect_reply"
  printf 'b false' > "$REAL_FAKE/is_loaded_reply"
  printf 'b true' > "$REAL_FAKE/prod_reply"
  printf 'b true' > "$REAL_FAKE/unload_reply"
  FAKE_LOAD_EXIT=0; FAKE_INTROSPECT_EXIT=0; FAKE_RUN_EXIT=0; FAKE_STOP_EXIT=0; FAKE_UNLOAD_EXIT=0
  export FAKE_LOAD_EXIT FAKE_INTROSPECT_EXIT FAKE_RUN_EXIT FAKE_STOP_EXIT FAKE_UNLOAD_EXIT
  FAKE_ORDER="in-order"; export FAKE_ORDER
}
queue_real_loaded() {
  rm -f -- "$REAL_FAKE/is_loaded_queue"
  for word in "$@"; do printf '%s\n' "$word" >> "$REAL_FAKE/is_loaded_queue"; done
}

RNONCE="$(printf '%s-%s-%s' "$RANDOM" "$$" "$(date +%s%N)" | sha256sum | cut -d' ' -f1 | head -c 64)"
ROWNER="shadow-real-owner"
RGEN="shadow-real-gen"
RREV="9"
RNONCE2="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
real_env
RNONCE="$RNONCE" ROWNER="$ROWNER" RGEN="$RGEN" RREV="$RREV" node -e '
const r = { nonce: process.env.RNONCE, correlationId: process.env.RNONCE, owner: process.env.ROWNER, generation: process.env.RGEN, revision: Number(process.env.RREV) };
require("node:fs").writeFileSync(process.argv[1], JSON.stringify(r));
' "$TMP_DIR/real-request.json"
if node "$SHADOW_BUILDER" --input "$TMP_DIR/real-request.json" --out "$SBUNDLE" >/dev/null 2>&1; then
  pass "real shadow fixture bundle built"
else
  fail "real shadow fixture bundle built"
fi
RSMANIFEST="$SMANIFEST"
seed_real_diag() {
  printf 'pre-run padding line\n' > "$TMP_DIR/real-diag.log"
  export FAKE_DIAG="$TMP_DIR/real-diag.log"
  local e s n
  e="$(sha256sum -- "$REPO_ROOT/kwin/src/shadow-describe-entry.ts" | cut -d' ' -f1)"
  s="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-shadow-projection.ts" | cut -d' ' -f1)"
  n="$(sha256sum -- "$REPO_ROOT/kwin/src/advisory-snapshot.ts" | cut -d' ' -f1)"
  FAKE_SOURCE="plasma-auto-tiler:shadow-describe-source:$e:$s:$n"
  FAKE_READY="plasma-auto-tiler:shadow-describe-ready:$RNONCE"
  FAKE_RESULT="plasma-auto-tiler:shadow-describe-result:v1:$RNONCE:$ROWNER:$RGEN:$RREV:$RNONCE:match"
  FAKE_AFTER="plasma-auto-tiler:shadow-describe-after:v1:$RNONCE:true"
  FAKE_APPEND=1
  export FAKE_SOURCE FAKE_READY FAKE_RESULT FAKE_AFTER FAKE_APPEND
}

# Exact lifecycle: valid id, exact object, production read-only.
real_reset; seed_real_diag; queue_real_loaded "b false" "b false" "b false" "b true"
if "$WRAPPER" start --bundle "$SBUNDLE" --manifest "$RSMANIFEST" --receipt "$TMP_DIR/real-r1.json" --diag-file "$TMP_DIR/real-diag.log" --input "$TMP_DIR/real-request.json" --attempts 5 --delay 0.01 > "$TMP_DIR/real-o1" 2>&1; then
  pass "shadow start accepts valid id 3"
else
  fail "shadow start accepts valid id 3"
fi
if grep -qF '"scriptId":3' "$TMP_DIR/real-r1.json" && grep -qF '"/Scripting/Script3"' "$TMP_DIR/real-r1.json" \
  && grep -qF '"shadowSha256"' "$TMP_DIR/real-r1.json"; then
  pass "shadow receipt records the exact id, object, and shadow binding"
else
  fail "shadow receipt records the exact id, object, and shadow binding"
fi
if grep -qF "loadScript ss $SBUNDLE plasma-auto-tiler-shadow-describe" "$REAL_FAKE/calls.log" \
  && grep -qF -- "--user introspect org.kde.KWin /Scripting/Script3" "$REAL_FAKE/calls.log" \
  && grep -qF "/Scripting/Script3 org.kde.kwin.Script run" "$REAL_FAKE/calls.log"; then
  pass "shadow exact Script path and object run"
else
  fail "shadow exact Script path and object run"
fi
if grep -qF 'isScriptLoaded s plasma-auto-tiler-kwin' "$REAL_FAKE/calls.log"; then pass "shadow production load state proven read-only on start"; else fail "shadow production load state proven read-only on start"; fi
if grep -qF 'unloadScript s plasma-auto-tiler-kwin' "$REAL_FAKE/calls.log" || grep -qF "loadScript ss $SBUNDLE plasma-auto-tiler-kwin" "$REAL_FAKE/calls.log"; then fail "shadow production never mutated on start"; else pass "shadow production never mutated on start"; fi
if grep -qF 'Scripting start' "$REAL_FAKE/calls.log"; then fail "shadow no global start on start"; else pass "shadow no global start on start"; fi

# Status/diagnostics/stop through the wrapper.
printf 'b true' > "$REAL_FAKE/is_loaded_reply"
if "$WRAPPER" status --receipt "$TMP_DIR/real-r1.json" > "$TMP_DIR/real-ostatus" 2>&1 && grep -qF 'state=loaded' "$TMP_DIR/real-ostatus"; then
  pass "shadow status reports the recorded load state"
else
  fail "shadow status reports the recorded load state"
fi
if "$WRAPPER" diagnostics --receipt "$TMP_DIR/real-r1.json" --diag-file "$TMP_DIR/real-diag.log" > "$TMP_DIR/real-odiag" 2>&1 && grep -qF 'markers=correlated' "$TMP_DIR/real-odiag"; then
  pass "shadow diagnostics validates correlated markers"
else
  fail "shadow diagnostics validates correlated markers"
fi
real_reset
queue_real_loaded "b true" "b false"
if "$WRAPPER" stop --receipt "$TMP_DIR/real-r1.json" > "$TMP_DIR/real-ostop" 2>&1 && grep -qF 'cleanup=verified' "$TMP_DIR/real-ostop"; then
  pass "shadow stop unloads the exact recorded id"
else
  fail "shadow stop unloads the exact recorded id"
fi
if [[ ! -e "$TMP_DIR/real-r1.json" ]]; then pass "shadow receipt removed after verified stop"; else fail "shadow receipt removed after verified stop"; fi
if grep -qF "/Scripting/Script3 org.kde.kwin.Script stop" "$REAL_FAKE/calls.log" && grep -qF "unloadScript s plasma-auto-tiler-shadow-describe" "$REAL_FAKE/calls.log"; then
  pass "shadow stop hits only the exact object and plugin"
else
  fail "shadow stop hits only the exact object and plugin"
fi

# Zero is valid when returned; non-canonical and malformed rejected with no guessed unload.
real_reset; seed_real_diag; queue_real_loaded "b false" "b false" "b false" "b true"
printf 'i 0' > "$REAL_FAKE/load_reply"
if "$WRAPPER" start --bundle "$SBUNDLE" --manifest "$RSMANIFEST" --receipt "$TMP_DIR/real-r0.json" --diag-file "$TMP_DIR/real-diag.log" --input "$TMP_DIR/real-request.json" --attempts 5 --delay 0.01 >/dev/null 2>&1 \
  && grep -qF '"scriptId":0' "$TMP_DIR/real-r0.json" && grep -qF '"/Scripting/Script0"' "$TMP_DIR/real-r0.json"; then
  pass "shadow start accepts valid id 0 with the exact object"
else
  fail "shadow start accepts valid id 0 with the exact object"
fi
rm -f -- "$TMP_DIR/real-r0.json"
for reply in "i 003" "i -1" "s hello" "i 2147483648" "oops"; do
  real_reset; seed_real_diag
  printf '%s' "$reply" > "$REAL_FAKE/load_reply"
  if "$WRAPPER" start --bundle "$SBUNDLE" --manifest "$RSMANIFEST" --receipt "$TMP_DIR/real-rbad.json" --diag-file "$TMP_DIR/real-diag.log" --input "$TMP_DIR/real-request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
    fail "shadow start must reject id reply: $reply"
  else
    pass "shadow start rejects id reply: $reply"
  fi
  if [[ -e "$TMP_DIR/real-rbad.json" ]]; then fail "shadow no receipt on rejected id: $reply"; else pass "shadow no receipt on rejected id: $reply"; fi
  if grep -qF 'unloadScript' "$REAL_FAKE/calls.log"; then
    fail "shadow no guessed unload on unknown object: $reply"
  else
    pass "shadow no guessed unload on unknown object: $reply"
  fi
  rm -f -- "$TMP_DIR/real-rbad.json"
done

# Run failure triggers partial cleanup of the exact id only.
real_reset; seed_real_diag; queue_real_loaded "b false" "b false" "b false" "b true"
FAKE_RUN_EXIT=1; export FAKE_RUN_EXIT
if "$WRAPPER" start --bundle "$SBUNDLE" --manifest "$RSMANIFEST" --receipt "$TMP_DIR/real-rrun.json" --diag-file "$TMP_DIR/real-diag.log" --input "$TMP_DIR/real-request.json" --attempts 5 --delay 0.01 >/dev/null 2>&1; then
  fail "shadow start must fail when run fails"
else
  pass "shadow start fails when run fails"
fi
if [[ -e "$TMP_DIR/real-rrun.json" ]]; then fail "shadow no receipt after run failure"; else pass "shadow no receipt after run failure"; fi
if grep -qF "/Scripting/Script3 org.kde.kwin.Script stop" "$REAL_FAKE/calls.log" && grep -qF "unloadScript s plasma-auto-tiler-shadow-describe" "$REAL_FAKE/calls.log"; then
  pass "shadow partial cleanup unloads only the exact id"
else
  fail "shadow partial cleanup unloads only the exact id"
fi
FAKE_RUN_EXIT=0; export FAKE_RUN_EXIT

# Bounded parser: wrong correlation, match with after false, stale refusal, other detail, ordering, source.
real_reset; seed_real_diag; queue_real_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:shadow-describe-result:v1:$RNONCE2:$ROWNER:$RGEN:$RREV:$RNONCE2:match"; export FAKE_RESULT
if "$WRAPPER" start --bundle "$SBUNDLE" --manifest "$RSMANIFEST" --receipt "$TMP_DIR/real-rcorr.json" --diag-file "$TMP_DIR/real-diag.log" --input "$TMP_DIR/real-request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "shadow start must reject wrong correlation"
else
  pass "shadow start rejects wrong correlation"
fi
rm -f -- "$TMP_DIR/real-rcorr.json"
real_reset; seed_real_diag; queue_real_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:shadow-describe-result:v1:$RNONCE:$ROWNER:$RGEN:$RREV:$RNONCE:match"
FAKE_AFTER="plasma-auto-tiler:shadow-describe-after:v1:$RNONCE:false"; export FAKE_RESULT FAKE_AFTER
if "$WRAPPER" start --bundle "$SBUNDLE" --manifest "$RSMANIFEST" --receipt "$TMP_DIR/real-rdrift.json" --diag-file "$TMP_DIR/real-diag.log" --input "$TMP_DIR/real-request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "shadow start must reject match with after false"
else
  pass "shadow start rejects match with after false"
fi
rm -f -- "$TMP_DIR/real-rdrift.json"
real_reset; seed_real_diag; queue_real_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:shadow-describe-result:v1:$RNONCE:$ROWNER:$RGEN:$RREV:$RNONCE:divergence"
FAKE_AFTER="plasma-auto-tiler:shadow-describe-after:v1:$RNONCE:true"; export FAKE_RESULT FAKE_AFTER
if "$WRAPPER" start --bundle "$SBUNDLE" --manifest "$RSMANIFEST" --receipt "$TMP_DIR/real-rdiv.json" --diag-file "$TMP_DIR/real-diag.log" --input "$TMP_DIR/real-request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  pass "shadow start accepts divergence with after true"
else
  fail "shadow start accepts divergence with after true"
fi
rm -f -- "$TMP_DIR/real-rdiv.json"
"$WRAPPER" stop --receipt "$TMP_DIR/real-rdiv.json" >/dev/null 2>&1 || true
real_reset; seed_real_diag; queue_real_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:shadow-describe-result:v1:$RNONCE:$ROWNER:$RGEN:$RREV:$RNONCE:reject:shadow-stale-snapshot"
FAKE_AFTER="plasma-auto-tiler:shadow-describe-after:v1:$RNONCE:false"; export FAKE_RESULT FAKE_AFTER
if "$WRAPPER" start --bundle "$SBUNDLE" --manifest "$RSMANIFEST" --receipt "$TMP_DIR/real-rstale.json" --diag-file "$TMP_DIR/real-diag.log" --input "$TMP_DIR/real-request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "shadow start must refuse a receipt on stale refusal"
else
  pass "shadow start refuses a receipt on stale refusal"
fi
if [[ -e "$TMP_DIR/real-rstale.json" ]]; then fail "shadow no receipt on stale refusal"; else pass "shadow no receipt on stale refusal"; fi
rm -f -- "$TMP_DIR/real-rstale.json"
real_reset; seed_real_diag; queue_real_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:shadow-describe-result:v1:$RNONCE:$ROWNER:$RGEN:$RREV:$RNONCE:could-execute:R2a:swap-neighbor"
FAKE_AFTER="plasma-auto-tiler:shadow-describe-after:v1:$RNONCE:true"; export FAKE_RESULT FAKE_AFTER
if "$WRAPPER" start --bundle "$SBUNDLE" --manifest "$RSMANIFEST" --receipt "$TMP_DIR/real-rother.json" --diag-file "$TMP_DIR/real-diag.log" --input "$TMP_DIR/real-request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "shadow start must reject advisory detail"
else
  pass "shadow start rejects advisory detail"
fi
rm -f -- "$TMP_DIR/real-rother.json"
real_reset; seed_real_diag; queue_real_loaded "b false" "b false" "b false" "b true"
FAKE_RESULT="plasma-auto-tiler:shadow-describe-result:v1:$RNONCE:$ROWNER:$RGEN:$RREV:$RNONCE:match"
FAKE_AFTER="plasma-auto-tiler:shadow-describe-after:v1:$RNONCE:true"; FAKE_ORDER="after-first"; export FAKE_RESULT FAKE_AFTER FAKE_ORDER
if "$WRAPPER" start --bundle "$SBUNDLE" --manifest "$RSMANIFEST" --receipt "$TMP_DIR/real-rorder.json" --diag-file "$TMP_DIR/real-diag.log" --input "$TMP_DIR/real-request.json" --attempts 3 --delay 0.01 >/dev/null 2>&1; then
  fail "shadow start must reject an after marker before the result"
else
  pass "shadow start rejects an after marker before the result"
fi
rm -f -- "$TMP_DIR/real-rorder.json"
FAKE_ORDER="in-order"; export FAKE_ORDER
real_reset; seed_real_diag; queue_real_loaded "b false" "b false" "b false" "b true"
FAKE_SOURCE=""; export FAKE_SOURCE
if "$WRAPPER" start --bundle "$SBUNDLE" --manifest "$RSMANIFEST" --receipt "$TMP_DIR/real-rsrc.json" --diag-file "$TMP_DIR/real-diag.log" --input "$TMP_DIR/real-request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "shadow start must reject a missing source marker"
else
  pass "shadow start rejects a missing source marker"
fi
rm -f -- "$TMP_DIR/real-rsrc.json"
real_reset; seed_real_diag; queue_real_loaded "b false" "b false" "b false" "b true"
printf 'no interfaces here' > "$REAL_FAKE/introspect_reply"
if "$WRAPPER" start --bundle "$SBUNDLE" --manifest "$RSMANIFEST" --receipt "$TMP_DIR/real-riface.json" --diag-file "$TMP_DIR/real-diag.log" --input "$TMP_DIR/real-request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "shadow start must reject a foreign object"
else
  pass "shadow start rejects a foreign object"
fi
rm -f -- "$TMP_DIR/real-riface.json"
# Production not loaded refuses; shadow already loaded refuses.
real_reset; seed_real_diag
printf 'b false' > "$REAL_FAKE/prod_reply"
if "$WRAPPER" start --bundle "$SBUNDLE" --manifest "$RSMANIFEST" --receipt "$TMP_DIR/real-rprod.json" --diag-file "$TMP_DIR/real-diag.log" --input "$TMP_DIR/real-request.json" --attempts 2 --delay 0.01 >/dev/null 2>&1; then
  fail "shadow start must refuse when production is not loaded"
else
  pass "shadow start refuses when production is not loaded"
fi
rm -f -- "$TMP_DIR/real-rprod.json"
printf 'b true' > "$REAL_FAKE/prod_reply"

printf 'shadow-lifecycle focused: pass=%s fail=%s\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
