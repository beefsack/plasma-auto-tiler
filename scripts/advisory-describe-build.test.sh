#!/usr/bin/env bash
# Static acceptance for the advisory DescribeAdvisoryPlan builder (test-only).
# No live KWin/Plasma actions: only node --check, builder accept/reject
# cases against the fixed dist path, deterministic byte checks, IIFE/ES2017
# bundle shape checks, and bounded-scope source assertions. Built bundle and
# manifest artifacts are removed before exit; they stay ignored/untracked.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BUILDER="$REPO_ROOT/scripts/advisory-describe-build.mjs"
ENTRY="$REPO_ROOT/kwin/src/advisory-describe-entry.ts"
QUERY="$REPO_ROOT/kwin/src/advisory-plan-query.ts"
SNAPSHOT="$REPO_ROOT/kwin/src/advisory-snapshot.ts"
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
INPUT="$TMP_DIR/request.json"
INPUT_BAD="$TMP_DIR/request-bad.json"

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

make_nonce() {
  printf '%s-%s-%s' "$RANDOM" "$$" "$(date +%s%N)" | sha256sum | cut -d' ' -f1 | head -c 64
}

write_input() {
  local nonce="$1" correlation="$2" owner="$3" generation="$4" revision="$5"
  NONCE="$nonce" CORRELATION="$correlation" OWNER="$owner" GENERATION="$generation" REVISION="$revision" node -e '
const nonce = process.env.NONCE;
const record = {
  nonce,
  correlationId: process.env.CORRELATION,
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
' "$INPUT"
}

if node --check "$BUILDER" >/dev/null 2>&1; then pass "node --check builder"; else fail "node --check builder"; fi
if bash -n "$REPO_ROOT/scripts/advisory-describe-build.test.sh" >/dev/null 2>&1; then pass "bash -n self"; else fail "bash -n self"; fi

# Entry shape: advisory-only source imports, KWin seams, nonce gate.
if [[ "$(grep -c '^import ' "$ENTRY")" -eq 2 ]]; then pass "entry has exactly two imports"; else fail "entry has exactly two imports"; fi
assert_contains "$ENTRY" 'from "./advisory-plan-query"'
assert_contains "$ENTRY" 'from "./advisory-snapshot"'
assert_contains "$ENTRY" 'captureAdvisorySnapshot(workspace'
assert_contains "$ENTRY" 'ADVISORY_DESCRIBE_SNAPSHOT_SHA256'
assert_contains "$ENTRY" 'new AdvisoryPlanQuery'
assert_contains "$ENTRY" 'callDBus(service, path, dbusInterface, method, payload, callback)'
assert_contains "$ENTRY" 'new QTimer()'
assert_contains "$ENTRY" 'query.enableOnce()'
assert_contains "$ENTRY" 'query.runOnce()'
assert_contains "$ENTRY" '0-9a-f]{32,128}'
assert_contains "$ENTRY" 'ADVISORY_DESCRIBE_REQUEST_JSON'
assert_absent "$ENTRY" 'from "./controller'
assert_absent "$ENTRY" 'from "./entry'
assert_absent "$ENTRY" 'poc3-'
assert_absent "$ENTRY" 'registerShortcut'
assert_absent "$ENTRY" 'plasma-auto-tiler-kwin'
if grep -qF -- 'advisory-plan-query' "$REPO_ROOT/kwin/src/entry.ts"; then fail "forbidden present: production entry imports advisory query"; else pass "absent: production entry imports advisory query"; fi
if grep -qF -- 'advisory-describe' "$REPO_ROOT/kwin/src/entry.ts"; then fail "forbidden present: production entry imports advisory describe"; else pass "absent: production entry imports advisory describe"; fi

NONCE="$(make_nonce)"
OWNER="adv-build-owner"
GENERATION="adv-build-gen"
write_input "$NONCE" "$NONCE" "$OWNER" "$GENERATION" "7"

# Builder strictness: exact unique args, exact input record, fixed output.
if node "$BUILDER" --input "$INPUT" >/dev/null 2>&1; then fail "builder must reject a missing --out"; else pass "builder rejects a missing --out"; fi
if node "$BUILDER" --out "$BUNDLE" >/dev/null 2>&1; then fail "builder must reject a missing --input"; else pass "builder rejects a missing --input"; fi
if node "$BUILDER" --input "$INPUT" --out "$BUNDLE" --extra x >/dev/null 2>&1; then fail "builder must reject an unknown flag"; else pass "builder rejects an unknown flag"; fi
if node "$BUILDER" --input "$INPUT" --input "$INPUT" --out "$BUNDLE" >/dev/null 2>&1; then fail "builder must reject a duplicate flag"; else pass "builder rejects a duplicate flag"; fi
if node "$BUILDER" --input "$TMP_DIR/missing.json" --out "$BUNDLE" >/dev/null 2>&1; then fail "builder must reject a missing input file"; else pass "builder rejects a missing input file"; fi
printf '{"bad":true}' > "$INPUT_BAD"
if node "$BUILDER" --input "$INPUT_BAD" --out "$BUNDLE" >/dev/null 2>&1; then fail "builder must reject a malformed record"; else pass "builder rejects a malformed record"; fi
write_input "short" "short" "$OWNER" "$GENERATION" "7"
if node "$BUILDER" --input "$INPUT" --out "$BUNDLE" >/dev/null 2>&1; then fail "builder must reject a short nonce"; else pass "builder rejects a short nonce"; fi
write_input "0123456789ABCDEF0123456789ABCDEF" "0123456789ABCDEF0123456789ABCDEF" "$OWNER" "$GENERATION" "7"
if node "$BUILDER" --input "$INPUT" --out "$BUNDLE" >/dev/null 2>&1; then fail "builder must reject an uppercase nonce"; else pass "builder rejects an uppercase nonce"; fi
write_input "$NONCE" "different-correlation-id" "$OWNER" "$GENERATION" "7"
if node "$BUILDER" --input "$INPUT" --out "$BUNDLE" >/dev/null 2>&1; then fail "builder must reject correlation != nonce"; else pass "builder rejects correlation != nonce"; fi
write_input "$NONCE" "$NONCE" "bad owner!" "$GENERATION" "7"
if node "$BUILDER" --input "$INPUT" --out "$BUNDLE" >/dev/null 2>&1; then fail "builder must reject a bad owner"; else pass "builder rejects a bad owner"; fi
write_input "$NONCE" "$NONCE" "$OWNER" "UPPER" "7"
if node "$BUILDER" --input "$INPUT" --out "$BUNDLE" >/dev/null 2>&1; then fail "builder must reject a bad generation"; else pass "builder rejects a bad generation"; fi
write_input "$NONCE" "$NONCE" "$OWNER" "$GENERATION" "1000001"
if node "$BUILDER" --input "$INPUT" --out "$BUNDLE" >/dev/null 2>&1; then fail "builder must reject a bad revision"; else pass "builder rejects a bad revision"; fi
write_input "$NONCE" "$NONCE" "$OWNER" "$GENERATION" "7"
if node "$BUILDER" --input "$INPUT" --out "$REPO_ROOT/kwin/dist/other.js" >/dev/null 2>&1; then fail "builder must reject a non-fixed --out path"; else pass "builder rejects a non-fixed --out path"; fi
if node "$BUILDER" --input "$INPUT" --out "$REPO_ROOT/kwin/contents/code/main.js" >/dev/null 2>&1; then fail "builder must never target the production bundle"; else pass "builder never targets the production bundle"; fi

# Symlink output refusal: a symlinked fixed path must fail with no target write.
ln -sf -- /dev/null "$TMP_DIR/link-target" 2>/dev/null || true
if [[ -L "$BUNDLE" ]]; then fail "pre-existing bundle symlink before symlink test"; rm -f -- "$BUNDLE"; else pass "no pre-existing bundle symlink"; fi
ln -sf -- "$TMP_DIR/link-target" "$BUNDLE"
if node "$BUILDER" --input "$INPUT" --out "$BUNDLE" >/dev/null 2>&1; then fail "builder must refuse a symlinked --out"; else pass "builder refuses a symlinked --out"; fi
if [[ -L "$BUNDLE" ]]; then pass "symlink left unwritten"; else fail "symlink was replaced"; fi
rm -f -- "$BUNDLE"

# Input symlink refusal plus manifest symlink refusal.
ln -sf -- "$INPUT" "$TMP_DIR/input-link.json"
if node "$BUILDER" --input "$TMP_DIR/input-link.json" --out "$BUNDLE" >/dev/null 2>&1; then fail "builder must refuse a symlinked --input"; else pass "builder refuses a symlinked --input"; fi
if [[ -e "$BUNDLE" ]]; then fail "no bundle on symlinked input"; else pass "no bundle on symlinked input"; fi
ln -sf -- "$INPUT" "$TMP_DIR/manifest-link.json"
if node "$BUILDER" --verify --input "$INPUT" --bundle "$BUNDLE" --manifest "$TMP_DIR/manifest-link.json" >/dev/null 2>&1; then fail "builder must refuse a symlinked manifest in verify"; else pass "builder refuses a symlinked manifest in verify"; fi
touch -- "$MANIFEST"
ln -sf -- "$MANIFEST" "$TMP_DIR/manifest-out-link.json" 2>/dev/null || true
rm -f -- "$MANIFEST"
ln -sf -- /dev/null "$MANIFEST"
if node "$BUILDER" --input "$INPUT" --out "$BUNDLE" >/dev/null 2>&1; then fail "builder must refuse a symlinked manifest output"; else pass "builder refuses a symlinked manifest output"; fi
if [[ -L "$MANIFEST" ]]; then pass "manifest symlink left unwritten"; else fail "manifest symlink was replaced"; fi
rm -f -- "$BUNDLE" "$MANIFEST"

# Input/output adjacency: input must never alias the fixed bundle or manifest.
cp -- "$INPUT" "$TMP_DIR/alias-check.json"
if node "$BUILDER" --input "$BUNDLE" --out "$BUNDLE" >/dev/null 2>&1; then fail "builder must reject input aliasing the fixed bundle"; else pass "builder rejects input aliasing the fixed bundle"; fi
touch -- "$BUNDLE" "$MANIFEST"
if node "$BUILDER" --input "$MANIFEST" --out "$BUNDLE" >/dev/null 2>&1; then fail "builder must reject input aliasing the fixed manifest"; else pass "builder rejects input aliasing the fixed manifest"; fi
rm -f -- "$BUNDLE" "$MANIFEST"
write_input "$NONCE" "$NONCE" "$OWNER" "$GENERATION" "7"

# Success path plus deterministic bytes.
if node "$BUILDER" --input "$INPUT" --out "$BUNDLE" >/dev/null 2>&1; then pass "builder emits the fixed bundle"; else fail "builder emits the fixed bundle"; fi
if [[ -f "$BUNDLE" && ! -L "$BUNDLE" && -f "$MANIFEST" && ! -L "$MANIFEST" ]]; then pass "bundle and manifest are regular files"; else fail "bundle and manifest are regular files"; fi
SHA_ONE="$(sha256sum -- "$BUNDLE" | cut -d' ' -f1)"
if node "$BUILDER" --input "$INPUT" --out "$BUNDLE" >/dev/null 2>&1; then pass "builder rebuilds"; else fail "builder rebuilds"; fi
SHA_TWO="$(sha256sum -- "$BUNDLE" | cut -d' ' -f1)"
if [[ "$SHA_ONE" == "$SHA_TWO" ]]; then pass "deterministic same-input bytes: $SHA_ONE"; else fail "deterministic same-input bytes"; fi

# Bundle shape: IIFE ES2017, no ESM/source-map, fixed exact input identity.
if head -c 60 -- "$BUNDLE" | grep -qF '(() =>'; then pass "bundle is an IIFE"; else fail "bundle is an IIFE"; fi
if grep -Eq -- '^import |^export ' "$BUNDLE"; then fail "forbidden present: ESM syntax in bundle"; else pass "absent: ESM syntax in bundle"; fi
if grep -qF -- 'from "./' "$BUNDLE"; then fail "forbidden present: source import in bundle"; else pass "absent: source import in bundle"; fi
if grep -qF -- 'sourceMappingURL' "$BUNDLE"; then fail "forbidden present: source map in bundle"; else pass "absent: source map in bundle"; fi
if grep -qF -- '?.' "$BUNDLE"; then fail "forbidden present: post-ES2017 optional chain in bundle"; else pass "absent: post-ES2017 optional chain in bundle"; fi
assert_contains "$BUNDLE" 'DescribeAdvisoryPlan'
assert_contains "$BUNDLE" 'plasma-auto-tiler:advisory-describe-ready'
assert_contains "$BUNDLE" 'plasma-auto-tiler:advisory-describe-result'
assert_contains "$BUNDLE" "$NONCE"
assert_contains "$BUNDLE" "$OWNER"
assert_absent "$BUNDLE" 'registerShortcut'
assert_absent "$BUNDLE" 'unloadScript'
assert_absent "$BUNDLE" 'plasma-auto-tiler-kwin'

# Sidecar manifest: exact keys, source bindings match, no machine paths.
if grep -qE -- '"schema":"advisory-describe-manifest-v1"' "$MANIFEST"; then pass "manifest schema"; else fail "manifest schema"; fi
for key in '"bundleSha256":"' '"entrySha256":"' '"querySha256":"' '"snapshotSha256":"' '"inputSha256":"' "\"nonce\":\"$NONCE\"" "\"owner\":\"$OWNER\"" "\"generation\":\"$GENERATION\"" '"revision":7'; do
  if grep -qF -- "$key" "$MANIFEST"; then pass "manifest carries: $key"; else fail "manifest missing: $key"; fi
done
ENTRY_SHA="$(sha256sum -- "$ENTRY" | cut -d' ' -f1)"
QUERY_SHA="$(sha256sum -- "$QUERY" | cut -d' ' -f1)"
SNAPSHOT_SHA="$(sha256sum -- "$SNAPSHOT" | cut -d' ' -f1)"
if grep -qF -- "$ENTRY_SHA" "$MANIFEST" && grep -qF -- "$ENTRY_SHA" "$BUNDLE"; then pass "entry binding matches manifest and bundle"; else fail "entry binding matches manifest and bundle"; fi
if grep -qF -- "$QUERY_SHA" "$MANIFEST" && grep -qF -- "$QUERY_SHA" "$BUNDLE"; then pass "query binding matches manifest and bundle"; else fail "query binding matches manifest and bundle"; fi
if grep -qF -- "$SNAPSHOT_SHA" "$MANIFEST" && grep -qF -- "$SNAPSHOT_SHA" "$BUNDLE"; then pass "snapshot binding matches manifest and bundle"; else fail "snapshot binding matches manifest and bundle"; fi
if grep -qF -- "$SHA_TWO" "$MANIFEST"; then pass "manifest carries the bundle sha"; else fail "manifest carries the bundle sha"; fi
INPUT_SHA="$(sha256sum -- "$INPUT" | cut -d' ' -f1)"
if grep -qF -- "$INPUT_SHA" "$MANIFEST"; then pass "manifest binds the exact input hash"; else fail "manifest binds the exact input hash"; fi
if grep -qF -- 'advisory-describe-result:v1:' "$BUNDLE"; then pass "bundle carries versioned result marker"; else
  if grep -qF -- 'ADVISORY_DESCRIBE_RESULT_SCHEMA' "$BUNDLE" && grep -qF -- 'advisory-describe-result' "$BUNDLE"; then pass "bundle carries versioned result schema"; else fail "bundle carries versioned result marker"; fi
fi
if grep -qE -- '/home/|/tmp/|/root/|/Users/' "$MANIFEST"; then fail "forbidden present: machine path in manifest"; else pass "absent: machine path in manifest"; fi
if grep -Eq -- '/home/|/tmp/opencode|/root/|/Users/' "$BUNDLE"; then fail "forbidden present: machine path in bundle"; else pass "absent: machine path in bundle"; fi

# Verify mode: deterministic rebuild without writing production outputs.
if node "$BUILDER" --verify --input "$INPUT" --bundle "$BUNDLE" --manifest "$MANIFEST" >/dev/null 2>&1; then pass "verify accepts the deterministic build"; else fail "verify accepts the deterministic build"; fi
mkdir -p -- "$TMP_DIR/verify-copy"
cp -- "$BUNDLE" "$TMP_DIR/verify-copy/advisory-describe.js"
cp -- "$MANIFEST" "$TMP_DIR/verify-copy/advisory-describe.manifest.json"
if node "$BUILDER" --verify --input "$INPUT" --bundle "$TMP_DIR/verify-copy/advisory-describe.js" --manifest "$TMP_DIR/verify-copy/advisory-describe.manifest.json" >/dev/null 2>&1; then pass "verify accepts an exact copy off the fixed path"; else fail "verify accepts an exact copy off the fixed path"; fi
# Manually altered bundle with a recomputed manifest sha must still fail verify.
printf '\n// manual alteration\n' >> "$TMP_DIR/verify-copy/advisory-describe.js"
ALTERED_SHA="$(sha256sum -- "$TMP_DIR/verify-copy/advisory-describe.js" | cut -d' ' -f1)"
node -e '
const fs = require("node:fs");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
m.bundleSha256 = process.argv[2];
fs.writeFileSync(process.argv[1], JSON.stringify(m) + "\n");
' "$TMP_DIR/verify-copy/advisory-describe.manifest.json" "$ALTERED_SHA"
if node "$BUILDER" --verify --input "$INPUT" --bundle "$TMP_DIR/verify-copy/advisory-describe.js" --manifest "$TMP_DIR/verify-copy/advisory-describe.manifest.json" >/dev/null 2>&1; then fail "verify must reject a manually altered bundle"; else pass "verify rejects a manually altered bundle"; fi
if [[ -e "$BUNDLE" && -e "$MANIFEST" ]]; then pass "verify left the fixed outputs in place"; else fail "verify left the fixed outputs in place"; fi
rm -rf -- "$TMP_DIR/verify-noprod"
mkdir -p -- "$TMP_DIR/verify-noprod"
cp -- "$BUNDLE" "$TMP_DIR/verify-noprod/advisory-describe.js"
cp -- "$MANIFEST" "$TMP_DIR/verify-noprod/advisory-describe.manifest.json"
rm -f -- "$BUNDLE" "$MANIFEST"
if node "$BUILDER" --verify --input "$INPUT" --bundle "$TMP_DIR/verify-noprod/advisory-describe.js" --manifest "$TMP_DIR/verify-noprod/advisory-describe.manifest.json" >/dev/null 2>&1; then pass "verify succeeds without fixed outputs present"; else fail "verify succeeds without fixed outputs present"; fi
if [[ ! -e "$BUNDLE" && ! -e "$MANIFEST" ]]; then pass "verify writes no production outputs"; else fail "verify writes no production outputs"; fi
if node "$BUILDER" --input "$INPUT" --out "$BUNDLE" >/dev/null 2>&1; then pass "builder restores the fixed bundle after verify"; else fail "builder restores the fixed bundle after verify"; fi

# Valid input containing formerly denied data text still builds.
write_input "$NONCE" "$NONCE" "workspace.x" "$GENERATION" "7"
if node "$BUILDER" --input "$INPUT" --out "$BUNDLE" >/dev/null 2>&1; then pass "builder accepts denied-text owner data"; else fail "builder accepts denied-text owner data"; fi
if grep -qF -- "workspace.x" "$BUNDLE"; then pass "denied-text data embedded without code conflation"; else fail "denied-text data embedded without code conflation"; fi
write_input "$NONCE" "$NONCE" "$OWNER" "$GENERATION" "7"
if node "$BUILDER" --input "$INPUT" --out "$BUNDLE" >/dev/null 2>&1; then pass "builder restores canonical input"; else fail "builder restores canonical input"; fi

# Cleanup proof: artifacts removed and ignored/untracked.
rm -f -- "$BUNDLE" "$MANIFEST"
if [[ ! -e "$BUNDLE" && ! -e "$MANIFEST" ]]; then pass "built outputs removed"; else fail "built outputs removed"; fi
if git -C "$REPO_ROOT" status --porcelain -- kwin/dist/advisory-describe.js kwin/dist/advisory-describe.manifest.json | grep -q .; then fail "forbidden present: tracked build residue"; else pass "absent: tracked build residue"; fi
if git -C "$REPO_ROOT" check-ignore -q -- kwin/dist/advisory-describe.js && git -C "$REPO_ROOT" check-ignore -q -- kwin/dist/advisory-describe.manifest.json; then pass "dist outputs ignored"; else fail "dist outputs ignored"; fi

printf 'advisory-describe build static: pass=%s fail=%s\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
