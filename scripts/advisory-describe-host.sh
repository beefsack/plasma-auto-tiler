#!/usr/bin/env bash
# Advisory DescribeAdvisoryPlan host lifecycle (future authorized host only).
#
# Not invoked now: no live KWin/Plasma, D-Bus, process, or session contact
# happens in this unit. Every transport below runs only on an explicit future
# authorized host pass, and only through the exact recorded receipt of this
# namespace. Static checks and fake-command tests cover the contract instead.
#
# The advisory bundle is read-only coexistence-safe: production stays loaded
# and is never queried, unloaded, or reloaded here. Before any transport the
# loader proves advisory-only shape against the exact current sources (pinned
# to the manifest shas and embedded in the bundle), checks the bundle only
# for IIFE/no-ESM/no-imports/no-source-map structure, requires byte-exact
# build identity plus the exact input binding, and runs the builder verify
# mode (deterministic rebuild to temp, byte-compare) before any bus call.
#
# Subcommands (all narrow, all receipt-scoped):
#   start --bundle B --manifest M --receipt R --diag-file D --input I
#         [--attempts N] [--delay S]
#     validate bundle plus manifest exactly, prove advisory-only shape,
#     loadScript the exact bundle under the fixed plugin id, introspect only
#     the returned /Scripting/Script<ID> object, run only that object, then
#     collect the correlation-bound ready/result markers boundedly. Writes
#     the receipt only on full success. Any run failure or identity mismatch
#     unloads only the recorded exact id and leaves no receipt.
#   status --receipt R
#     strict-parse the receipt, then report only the recorded plugin load
#     state plus the recorded identity. No mutation.
#   diagnostics --receipt R [--diag-file D]
#     strict-parse the receipt and re-validate the recorded correlation-bound
#     markers in the given diag file when supplied. No bus mutation.
#   stop --receipt R
#     strict-parse the receipt, stop only the recorded exact object, unload
#     only the recorded exact plugin id, verify absent, remove the receipt.
#
# Diagnostics contract (emitted by kwin/src/advisory-describe-entry.ts):
#   source: plasma-auto-tiler:advisory-describe-source:<entrySha>:<querySha>
#   ready:  plasma-auto-tiler:advisory-describe-ready:<correlation>
#   result: plasma-auto-tiler:advisory-describe-result:v1:<correlation>:<owner>:
#           <generation>:<revision>:<nonce>:<detail>
# The loader accepts a result only when the fixed v1 prefix sits at column
# zero with every identity field equal to the manifest record and the detail
# suffix matching [A-Za-z0-9._:-]{1,512}. Mid-line prefixes, empty/oversize
# details, and any generation/revision/nonce mismatch fail closed with
# exact-id cleanup. The bound source marker is required post-run in start and
# on diagnostics with a diag file. Receipt creation is exclusive (real parent
# dir, symlink refusal, noclobber) and never overwrites.
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
KWIN_DIR="$REPO_ROOT/kwin"
SRC_ENTRY="$KWIN_DIR/src/advisory-describe-entry.ts"
SRC_QUERY="$KWIN_DIR/src/advisory-plan-query.ts"
BUILDER="$REPO_ROOT/scripts/advisory-describe-build.mjs"
PLUGIN="plasma-auto-tiler-advisory-describe"
BUNDLE_BASENAME="advisory-describe.js"
MANIFEST_BASENAME="advisory-describe.manifest.json"
MANIFEST_SCHEMA="advisory-describe-manifest-v1"
RECEIPT_SCHEMA="advisory-describe-receipt-v1"
RESULT_SCHEMA="v1"
RESULT_DETAIL_RE='^[A-Za-z0-9._:-]{1,512}$'
: "${BUSCTL_BIN:=busctl}"
: "${SHA256SUM_BIN:=sha256sum}"
: "${NODE_BIN:=node}"

BUS_DEST="org.kde.KWin"
BUS_PATH="/Scripting"
BUS_SCRIPTING_IFACE="org.kde.kwin.Scripting"
BUS_SCRIPT_IFACE="org.kde.kwin.Script"

SCRIPT_ID=""
SCRIPT_OBJ=""
RECEIPT_CREATED="0"
RECEIPT_PATH=""

# Fixed static advisory-only shape. Allow tokens must each occur in the
# exact bundle bytes; deny tokens must each be absent. This gate runs before
# any transport and is what permits coexistence with a loaded production
# plugin (which is never queried here).
ALLOW_TOKENS=(
  "AdvisoryPlanQuery"
  "DescribeAdvisoryPlan"
  "callDBus"
  "QTimer"
  "advisory-describe-ready"
  "advisory-describe-result"
  "advisory-describe-source"
)
DENY_TOKENS=(
  "workspace."
  "registerShortcut"
  "TileController"
  "Tile"
  "manage"
  "unmanage"
  "activeWindow"
  "frameGeometry"
  "showOutline"
  "hideOutline"
  "CustomTile"
  "EvaluateMove"
  "PublishSnapshot"
  "poc3"
  "POC3"
  "planner-shadow"
  "isScriptLoaded"
  "unloadScript"
  "loadScript"
  "Scripting"
  "socket"
  "fetch("
  "XMLHttpRequest"
  "require("
  "sourceMappingURL"
  "createDesktop"
  "removeDesktop"
  "closeWindow"
  "setActiveWindow"
  "rootTile"
  "currentDesktop"
  "windowList"
  "clientArea"
  "shortcut"
  "Shortcut"
  "tray"
  "Tray"
  "controller"
  "Controller"
  "desktops"
  "screens"
  "Output"
  "Execute"
  "apply"
  "geometry"
  "setTimeout"
  "setInterval"
  "process.env"
  "__dirname"
  "child_process"
  "/dev/tcp"
  "socat"
  "plasma-auto-tiler-kwin"
)

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'EOF'
usage: advisory-describe-host.sh <start|status|diagnostics|stop> [flags] [--help]

Future authorized-host lifecycle for the advisory DescribeAdvisoryPlan
bundle. Not invoked now; covered by static checks and fake-command tests.

  start --bundle B --manifest M --receipt R --diag-file D --input I
        [--attempts N] [--delay S]
  status --receipt R
  diagnostics --receipt R [--diag-file D]
  stop --receipt R
  --help  show this help and exit

Fixed plugin id plasma-auto-tiler-advisory-describe. Production is never queried, unloaded,
or reloaded. Transport uses loadScript with the exact bundle, introspects
only the returned /Scripting/Script<ID> object, and runs only that object
(never a global start). Receipts carry exact bundle sha, source bindings,
and KWin identity; stop unloads only the recorded exact id.
EOF
}

safe_abs() {
  local path="$1"
  [[ "$path" == /* && "$path" != *'//' && "$path" != *'/../'* \
    && "$path" != */.. && "$path" != */./* && "$path" != */. ]] || return 1
  [[ "$path" != "/" ]] || return 1
}

require_regular_file() {
  local path="$1" label="$2"
  safe_abs "$path" || fail "$label path is unsafe: $path"
  [[ -f "$path" && ! -L "$path" ]] || fail "$label must be a regular non-symlink file: $path"
  [[ -r "$path" ]] || fail "$label is unreadable: $path"
}

valid_hex64() { [[ "$1" =~ ^[0-9a-f]{64}$ ]]; }
valid_nonce() { [[ "$1" =~ ^[0-9a-f]{32,128}$ ]]; }
valid_owner() { [[ "$1" =~ ^[A-Za-z0-9._-]{1,128}$ ]]; }
valid_generation() { [[ "$1" =~ ^[a-z0-9-]{1,64}$ ]]; }
valid_canonical_uint() { [[ "$1" =~ ^(0|[1-9][0-9]*)$ ]]; }
valid_revision() { valid_canonical_uint "$1" && [[ "$1" -le 1000000 ]]; }
valid_script_id() { valid_canonical_uint "$1" && [[ "$1" -le 2147483647 ]]; }
valid_detail() { [[ "$1" =~ $RESULT_DETAIL_RE ]]; }

sha256_file() {
  "$SHA256SUM_BIN" -- "$1" 2>/dev/null | sed -n 's/^\([0-9a-f]\{64\}\) .*/\1/p' || true
}

# Strict single-line JSON parsing via Node (no new dependency): rejects
# multiline, CR, duplicate keys, and unexpected keys, validates the narrow
# fixed schema, and prints only shell-safe assignments (values already
# restricted to safe charsets, so the caller's eval cannot meet shell
# metacharacters). Fails closed on any malformation.
node_parse_json_file() {
  local kind="$1" file="$2"
  command -v "$NODE_BIN" >/dev/null 2>&1 || { echo "error: required tool '$NODE_BIN' not found in PATH" >&2; return 1; }
  MANIFEST_SCHEMA_EXPECTED="$MANIFEST_SCHEMA" RECEIPT_SCHEMA_EXPECTED="$RECEIPT_SCHEMA" \
    BUNDLE_BASENAME_EXPECTED="$BUNDLE_BASENAME" PLUGIN_EXPECTED="$PLUGIN" PARSE_KIND="$kind" \
    "$NODE_BIN" -e '
const fs = require("node:fs");
const file = process.argv[1];
const kind = process.env.PARSE_KIND;
let text;
try { text = fs.readFileSync(file, "utf8"); } catch (e) { console.error("error: cannot read " + kind); process.exit(1); }
if (text.includes("\r")) { console.error("error: " + kind + " must be single-line JSON without CR"); process.exit(1); }
if (!text.endsWith("\n")) { console.error("error: " + kind + " must end with a single newline"); process.exit(1); }
const body = text.slice(0, -1);
if (body.includes("\n")) { console.error("error: " + kind + " must be single-line JSON"); process.exit(1); }
let parsed;
try { parsed = JSON.parse(body); } catch (e) { console.error("error: " + kind + " is not valid JSON"); process.exit(1); }
if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) { console.error("error: " + kind + " must be a JSON object"); process.exit(1); }
const manifestKeys = ["schema","bundle","bundleSha256","entry","entrySha256","query","querySha256","nonce","correlationId","owner","generation","revision","inputSha256"];
const receiptKeys = ["schema","plugin","scriptId","scriptObject","bundleSha256","entrySha256","querySha256","owner","generation","revision","correlationId","nonce"];
const expected = kind === "manifest" ? manifestKeys : receiptKeys;
const keys = Object.keys(parsed);
if (keys.length !== expected.length) { console.error("error: " + kind + " has unexpected keys"); process.exit(1); }
for (const k of expected) {
  if (!Object.prototype.hasOwnProperty.call(parsed, k)) { console.error("error: " + kind + " is missing key " + k); process.exit(1); }
  const matches = body.match(new RegExp("\"" + k + "\"\\s*:", "g")) || [];
  if (matches.length !== 1) { console.error("error: " + kind + " key " + k + " must occur exactly once"); process.exit(1); }
}
const hex64 = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const nonce = (v) => typeof v === "string" && /^[0-9a-f]{32,128}$/.test(v);
const owner = (v) => typeof v === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(v);
const generation = (v) => typeof v === "string" && /^[a-z0-9-]{1,64}$/.test(v);
const canonical = (v) => typeof v === "number" && Number.isInteger(v) && /^(0|[1-9][0-9]*)$/.test(String(v));
const fail = (m) => { console.error("error: " + kind + " " + m); process.exit(1); };
if (kind === "manifest") {
  if (parsed.schema !== process.env.MANIFEST_SCHEMA_EXPECTED) fail("schema mismatch");
  if (parsed.bundle !== process.env.BUNDLE_BASENAME_EXPECTED) fail("bundle mismatch");
  if (parsed.entry !== "advisory-describe-entry.ts") fail("entry mismatch");
  if (parsed.query !== "advisory-plan-query.ts") fail("query mismatch");
  if (!hex64(parsed.bundleSha256)) fail("bundle sha is malformed");
  if (!hex64(parsed.entrySha256)) fail("entry sha is malformed");
  if (!hex64(parsed.querySha256)) fail("query sha is malformed");
  if (!hex64(parsed.inputSha256)) fail("input sha is malformed");
  if (!nonce(parsed.nonce)) fail("nonce is malformed");
  if (parsed.correlationId !== parsed.nonce) fail("correlation must equal the nonce");
  if (!owner(parsed.owner)) fail("owner is malformed");
  if (!generation(parsed.generation)) fail("generation is malformed");
  if (!(canonical(parsed.revision) && parsed.revision >= 0 && parsed.revision <= 1000000)) fail("revision is malformed");
  console.log("MANIFEST_BUNDLE_SHA=" + parsed.bundleSha256);
  console.log("MANIFEST_ENTRY_SHA=" + parsed.entrySha256);
  console.log("MANIFEST_QUERY_SHA=" + parsed.querySha256);
  console.log("MANIFEST_INPUT_SHA=" + parsed.inputSha256);
  console.log("MANIFEST_NONCE=" + parsed.nonce);
  console.log("MANIFEST_CORRELATION=" + parsed.correlationId);
  console.log("MANIFEST_OWNER=" + parsed.owner);
  console.log("MANIFEST_GENERATION=" + parsed.generation);
  console.log("MANIFEST_REVISION=" + parsed.revision);
} else {
  if (parsed.schema !== process.env.RECEIPT_SCHEMA_EXPECTED) fail("schema mismatch");
  if (parsed.plugin !== process.env.PLUGIN_EXPECTED) fail("plugin mismatch");
  if (!(canonical(parsed.scriptId) && parsed.scriptId >= 0 && parsed.scriptId <= 2147483647)) fail("script id is malformed or out of range");
  if (parsed.scriptObject !== ("/Scripting/Script" + parsed.scriptId)) fail("object must be the exact Script id path");
  if (!hex64(parsed.bundleSha256)) fail("bundle sha is malformed");
  if (!hex64(parsed.entrySha256)) fail("entry sha is malformed");
  if (!hex64(parsed.querySha256)) fail("query sha is malformed");
  if (!owner(parsed.owner)) fail("owner is malformed");
  if (!generation(parsed.generation)) fail("generation is malformed");
  if (!(canonical(parsed.revision) && parsed.revision >= 0 && parsed.revision <= 1000000)) fail("revision is malformed");
  if (!nonce(parsed.nonce)) fail("nonce is malformed");
  if (parsed.correlationId !== parsed.nonce) fail("correlation must equal the nonce");
  console.log("RECEIPT_PLUGIN=" + parsed.plugin);
  console.log("RECEIPT_SCRIPT_ID=" + parsed.scriptId);
  console.log("RECEIPT_SCRIPT_OBJ=" + parsed.scriptObject);
  console.log("RECEIPT_BUNDLE_SHA=" + parsed.bundleSha256);
  console.log("RECEIPT_ENTRY_SHA=" + parsed.entrySha256);
  console.log("RECEIPT_QUERY_SHA=" + parsed.querySha256);
  console.log("RECEIPT_OWNER=" + parsed.owner);
  console.log("RECEIPT_GENERATION=" + parsed.generation);
  console.log("RECEIPT_REVISION=" + parsed.revision);
  console.log("RECEIPT_CORRELATION=" + parsed.correlationId);
  console.log("RECEIPT_NONCE=" + parsed.nonce);
}
' -- "$file" || return 1
}

# Manifest contract: single-line JSON with fixed keys, fixed basenames, and
# safe bounded identity fields. Prints shell-safe assignments on stdout.
parse_manifest() {
  node_parse_json_file "manifest" "$1"
}

# Receipt contract: single-line JSON with fixed keys binding the exact KWin
# identity (plugin, script id, exact object) to the exact bundle sha, source
# bindings, and request identity. Prints shell-safe assignments on stdout.
parse_receipt() {
  node_parse_json_file "receipt" "$1"
}

prove_advisory_only() {
  local bundle="$1" token="" src=""
  # Allow/deny shape is proven against the exact current sources (which the
  # loader also pins to the manifest shas and which the bundle embeds). The
  # bundle's embedded input is opaque data and must never be deny-scanned, so
  # the bundle itself is checked only for IIFE/no-ESM/no-imports/no-source-map
  # structure plus embedded source bindings (checked by the caller).
  for token in "${ALLOW_TOKENS[@]}"; do
    if ! grep -Fq -- "$token" "$SRC_ENTRY" 2>/dev/null && ! grep -Fq -- "$token" "$SRC_QUERY" 2>/dev/null; then
      echo "error: advisory source lacks marker: $token" >&2
      return 1
    fi
  done
  for src in "$SRC_ENTRY" "$SRC_QUERY"; do
    for token in "${DENY_TOKENS[@]}"; do
      if grep -Fq -- "$token" "$src"; then
        echo "error: advisory source carries a forbidden non-advisory marker: $token ($src)" >&2
        return 1
      fi
    done
  done
  if grep -Eq -- '^import |^export ' "$bundle"; then
    echo "error: bundle carries ESM syntax" >&2
    return 1
  fi
  if grep -Fq -- 'from "./' "$bundle"; then
    echo "error: bundle carries a source import" >&2
    return 1
  fi
}

parse_script_id() {
  local reply="$1" id=""
  [[ "$reply" =~ ^i[[:space:]]+(0|[1-9][0-9]*)[[:space:]]*$ ]] || return 1
  id="${BASH_REMATCH[1]}"
  valid_script_id "$id" || return 1
  printf '%s' "$id"
}

parse_bool() {
  local reply="$1"
  [[ "$reply" =~ ^b[[:space:]]+(true|false)[[:space:]]*$ ]] || return 1
  printf '%s' "${BASH_REMATCH[1]}"
}

exact_cleanup() {
  [[ -n "$SCRIPT_ID" ]] || return 1
  valid_script_id "$SCRIPT_ID" || return 1
  "$BUSCTL_BIN" call "$BUS_DEST" "$SCRIPT_OBJ" "$BUS_SCRIPT_IFACE" stop >/dev/null 2>&1 || true
  local out=""
  out="$("$BUSCTL_BIN" call "$BUS_DEST" "$BUS_PATH" "$BUS_SCRIPTING_IFACE" unloadScript s "$PLUGIN" 2>/dev/null)" || return 1
  [[ "$(parse_bool "$out")" == "true" ]] || return 1
  [[ "$(loaded_word "$PLUGIN")" == "not-loaded" ]] || return 1
}

partial_cleanup() {
  local state="unverified"
  if [[ -n "$SCRIPT_ID" ]] && exact_cleanup >/dev/null 2>&1; then state="verified"; fi
  if [[ "$RECEIPT_CREATED" == "1" && -n "$RECEIPT_PATH" ]]; then rm -f -- "$RECEIPT_PATH" 2>/dev/null || true; fi
  printf 'plasma-auto-tiler-advisory-describe: partial script-id=%s cleanup=%s\n' "${SCRIPT_ID:-unknown}" "$state" >&2
}

loaded_word() {
  local plugin="$1" out=""
  out="$("$BUSCTL_BIN" call "$BUS_DEST" "$BUS_PATH" "$BUS_SCRIPTING_IFACE" isScriptLoaded s "$plugin" 2>/dev/null)" || {
    echo "error: isScriptLoaded call failed for '$plugin'" >&2
    return 1
  }
  local word=""
  word="$(parse_bool "$out")" || { echo "error: unexpected isScriptLoaded reply for '$plugin': $out" >&2; return 1; }
  if [[ "$word" == "true" ]]; then printf 'loaded\n'; else printf 'not-loaded\n'; fi
}

require_receipt_parent() {
  local receipt="$1" parent=""
  parent="$(dirname -- "$receipt")"
  [[ -n "$parent" ]] || return 1
  [[ ! -L "$parent" ]] || { echo "error: receipt parent must not be a symlink: $parent" >&2; return 1; }
  [[ -d "$parent" ]] || { echo "error: receipt parent must be a real directory: $parent" >&2; return 1; }
}

# Bounded correlated marker scan: only bytes appended after the pre-run
# boundary (fixed 64KiB tail window of the post-run slice). Exact-line mode
# requires a full-line match; prefix mode requires the fixed prefix at column
# zero (a mid-line occurrence never matches). Prints the last matching line
# truncated to 1KiB.
wait_diag_line() {
  local file="$1" start="$2" pattern="$3" exact="$4" attempts="$5" delay="$6"
  local attempt=0 slice="" found="" line=""
  while [[ "$attempt" -lt "$attempts" ]]; do
    slice="$(tail -c "+$((start + 1))" -- "$file" 2>/dev/null | tail -c 65536 2>/dev/null)" || slice=""
    found=""
    if [[ "$exact" == "line" ]]; then
      found="$(printf '%s' "$slice" | grep -F -x -- "$pattern" | tail -n 1 | head -c 1024)" || found=""
    else
      while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" == "$pattern"* ]]; then
          found="$line"
        fi
      done <<< "$slice"
      found="$(printf '%s' "$found" | head -c 1024)" || found=""
    fi
    if [[ -n "$found" ]]; then
      printf '%s' "$found"
      return 0
    fi
    sleep "$delay" || return 1
    attempt=$((attempt + 1))
  done
  return 1
}

# Versioned result validation: exact column-zero prefix carrying schema plus
# correlation/owner/generation/revision/nonce, with a bounded valid detail
# suffix. Prints the detail on success.
check_result_line() {
  local line="$1" correlation="$2" owner="$3" generation="$4" revision="$5" nonce="$6"
  local prefix="plasma-auto-tiler:advisory-describe-result:$RESULT_SCHEMA:$correlation:$owner:$generation:$revision:$nonce:"
  [[ "$line" == "$prefix"* ]] || return 1
  local detail="${line#"$prefix"}"
  [[ -n "$detail" ]] || return 1
  [[ "${#detail}" -le 512 ]] || return 1
  [[ "$detail" != *$'\n'* && "$detail" != *$'\r'* ]] || return 1
  valid_detail "$detail" || return 1
  printf '%s' "$detail"
}

result_prefix_for() {
  printf 'plasma-auto-tiler:advisory-describe-result:%s:%s:%s:%s:%s:%s:' "$RESULT_SCHEMA" "$1" "$2" "$3" "$4" "$5"
}

source_line_for() {
  printf 'plasma-auto-tiler:advisory-describe-source:%s:%s' "$1" "$2"
}

parse_start_args() {
  START_BUNDLE=""; START_MANIFEST=""; START_RECEIPT=""; START_DIAG=""; START_INPUT=""; START_ATTEMPTS="50"; START_DELAY="0.1"
  local seen_bundle=0 seen_manifest=0 seen_receipt=0 seen_diag=0 seen_attempts=0 seen_delay=0 seen_input=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --bundle) [[ "$seen_bundle" -eq 0 ]] || fail "duplicate --bundle"; seen_bundle=1; [[ -n "${2:-}" ]] || fail "missing value for --bundle"; START_BUNDLE="$2"; shift 2 ;;
      --manifest) [[ "$seen_manifest" -eq 0 ]] || fail "duplicate --manifest"; seen_manifest=1; [[ -n "${2:-}" ]] || fail "missing value for --manifest"; START_MANIFEST="$2"; shift 2 ;;
      --receipt) [[ "$seen_receipt" -eq 0 ]] || fail "duplicate --receipt"; seen_receipt=1; [[ -n "${2:-}" ]] || fail "missing value for --receipt"; START_RECEIPT="$2"; shift 2 ;;
      --diag-file) [[ "$seen_diag" -eq 0 ]] || fail "duplicate --diag-file"; seen_diag=1; [[ -n "${2:-}" ]] || fail "missing value for --diag-file"; START_DIAG="$2"; shift 2 ;;
      --input) [[ "$seen_input" -eq 0 ]] || fail "duplicate --input"; seen_input=1; [[ -n "${2:-}" ]] || fail "missing value for --input"; START_INPUT="$2"; shift 2 ;;
      --attempts) [[ "$seen_attempts" -eq 0 ]] || fail "duplicate --attempts"; seen_attempts=1; [[ -n "${2:-}" ]] || fail "missing value for --attempts"; START_ATTEMPTS="$2"; shift 2 ;;
      --delay) [[ "$seen_delay" -eq 0 ]] || fail "duplicate --delay"; seen_delay=1; [[ -n "${2:-}" ]] || fail "missing value for --delay"; START_DELAY="$2"; shift 2 ;;
      *) fail "unknown start flag '$1'" ;;
    esac
  done
  [[ -n "$START_BUNDLE" ]] || fail "start requires --bundle"
  [[ -n "$START_MANIFEST" ]] || fail "start requires --manifest"
  [[ -n "$START_RECEIPT" ]] || fail "start requires --receipt"
  [[ -n "$START_DIAG" ]] || fail "start requires --diag-file"
  [[ -n "$START_INPUT" ]] || fail "start requires --input"
  [[ "$START_ATTEMPTS" =~ ^(0|[1-9][0-9]*)$ && "$START_ATTEMPTS" -ge 1 && "$START_ATTEMPTS" -le 500 ]] || fail "invalid --attempts (1..500)"
  [[ "$START_DELAY" =~ ^(0(\.[0-9]+)?|[1-9][0-9]*(\.[0-9]+)?)$ ]] || fail "invalid --delay"
}

cmd_start() {
  parse_start_args "$@"
  command -v "$BUSCTL_BIN" >/dev/null 2>&1 || fail "required tool '$BUSCTL_BIN' not found in PATH"
  command -v "$SHA256SUM_BIN" >/dev/null 2>&1 || fail "required tool '$SHA256SUM_BIN' not found in PATH"
  command -v "$NODE_BIN" >/dev/null 2>&1 || fail "required tool '$NODE_BIN' not found in PATH"
  require_regular_file "$START_BUNDLE" "bundle"
  require_regular_file "$START_MANIFEST" "manifest"
  require_regular_file "$START_DIAG" "diag file"
  require_regular_file "$START_INPUT" "input"
  require_regular_file "$SRC_ENTRY" "advisory entry source"
  require_regular_file "$SRC_QUERY" "advisory query source"
  [[ "${START_BUNDLE##*/}" == "$BUNDLE_BASENAME" ]] || fail "bundle must be exactly $BUNDLE_BASENAME"
  [[ "${START_MANIFEST##*/}" == "$MANIFEST_BASENAME" ]] || fail "manifest must be exactly $MANIFEST_BASENAME"
  safe_abs "$START_RECEIPT" || fail "receipt path is unsafe: $START_RECEIPT"
  require_receipt_parent "$START_RECEIPT" || exit 1
  if [[ -e "$START_RECEIPT" || -L "$START_RECEIPT" ]]; then
    fail "receipt already exists; stop the recorded script first: $START_RECEIPT"
  fi
  local manifest_eval=""
  manifest_eval="$(parse_manifest "$START_MANIFEST")" || exit 1
  local MANIFEST_BUNDLE_SHA="" MANIFEST_ENTRY_SHA="" MANIFEST_QUERY_SHA="" MANIFEST_INPUT_SHA="" MANIFEST_NONCE="" MANIFEST_CORRELATION="" MANIFEST_OWNER="" MANIFEST_GENERATION="" MANIFEST_REVISION=""
  eval "$manifest_eval"
  local actual_input_sha
  actual_input_sha="$(sha256_file "$START_INPUT")"
  [[ -n "$actual_input_sha" ]] || fail "could not hash the input"
  [[ "$actual_input_sha" == "$MANIFEST_INPUT_SHA" ]] || fail "input bytes do not match the manifest input binding"
  local actual_bundle_sha actual_entry_sha actual_query_sha
  actual_bundle_sha="$(sha256_file "$START_BUNDLE")"
  [[ "$actual_bundle_sha" == "$MANIFEST_BUNDLE_SHA" ]] || fail "bundle bytes do not match the manifest build identity"
  actual_entry_sha="$(sha256_file "$SRC_ENTRY")"
  actual_query_sha="$(sha256_file "$SRC_QUERY")"
  [[ "$actual_entry_sha" == "$MANIFEST_ENTRY_SHA" ]] || fail "entry source does not match the manifest build identity"
  [[ "$actual_query_sha" == "$MANIFEST_QUERY_SHA" ]] || fail "query source does not match the manifest build identity"
  grep -Fq -- "$MANIFEST_ENTRY_SHA" "$START_BUNDLE" || fail "bundle lacks the embedded entry source binding"
  grep -Fq -- "$MANIFEST_QUERY_SHA" "$START_BUNDLE" || fail "bundle lacks the embedded query source binding"
  prove_advisory_only "$START_BUNDLE" || exit 1
  # Deterministic rebuild verification before any bus transport: rejects a
  # manually altered bundle even when its manifest bundle sha was recomputed.
  # The verify path rebuilds to a temp directory and never writes dist outputs.
  "$NODE_BIN" -- "$BUILDER" --verify --input "$START_INPUT" --bundle "$START_BUNDLE" --manifest "$START_MANIFEST" >/dev/null 2>&1 || {
    echo "error: deterministic rebuild verification failed" >&2
    return 1
  }
  # The following node invocation is the builder verify above (node + builder
  # only); bus transport below uses only the pinned BUSCTL_BIN tool.
  local diag_start=""
  diag_start="$(wc -c < "$START_DIAG" 2>/dev/null | tr -d ' ')" || fail "could not snapshot the diag boundary"
  [[ "$diag_start" =~ ^(0|[1-9][0-9]*)$ ]] || fail "diag boundary is not a byte size; refusing stale-prone scan"
  [[ "$(loaded_word "$PLUGIN")" == "not-loaded" ]] || fail "plugin '$PLUGIN' is already loaded; stop the recorded script first"
  local load_out=""
  load_out="$("$BUSCTL_BIN" call "$BUS_DEST" "$BUS_PATH" "$BUS_SCRIPTING_IFACE" loadScript ss "$START_BUNDLE" "$PLUGIN" 2>/dev/null)" || {
    fail "loadScript call failed for '$PLUGIN'"
  }
  SCRIPT_ID="$(parse_script_id "$load_out")" || {
    printf 'error: unexpected loadScript reply: %s\n' "$load_out" >&2
    exit 1
  }
  SCRIPT_OBJ="/Scripting/Script$SCRIPT_ID"
  local introspect_out=""
  introspect_out="$("$BUSCTL_BIN" introspect "$BUS_DEST" "$SCRIPT_OBJ" 2>/dev/null)" || {
    partial_cleanup
    fail "introspect failed for $SCRIPT_OBJ"
  }
  printf '%s' "$introspect_out" | grep -Fq "org.kde.kwin.Script" || {
    partial_cleanup
    fail "$SCRIPT_OBJ does not expose the Script interface"
  }
  [[ "$(loaded_word "$PLUGIN")" == "loaded" ]] || {
    partial_cleanup
    fail "plugin '$PLUGIN' was not reported loaded after exact object introspection"
  }
  "$BUSCTL_BIN" call "$BUS_DEST" "$SCRIPT_OBJ" "$BUS_SCRIPT_IFACE" run >/dev/null 2>&1 || {
    partial_cleanup
    fail "run() failed on $SCRIPT_OBJ"
  }
  local ready_line result_prefix result_line detail source_line
  source_line="$(source_line_for "$MANIFEST_ENTRY_SHA" "$MANIFEST_QUERY_SHA")"
  wait_diag_line "$START_DIAG" "$diag_start" "$source_line" "line" "$START_ATTEMPTS" "$START_DELAY" >/dev/null || {
    partial_cleanup
    fail "bound source marker not observed; refusing without source evidence"
  }
  ready_line="plasma-auto-tiler:advisory-describe-ready:$MANIFEST_CORRELATION"
  wait_diag_line "$START_DIAG" "$diag_start" "$ready_line" "line" "$START_ATTEMPTS" "$START_DELAY" >/dev/null || {
    partial_cleanup
    fail "correlated ready marker not observed; refusing without readback evidence"
  }
  result_prefix="$(result_prefix_for "$MANIFEST_CORRELATION" "$MANIFEST_OWNER" "$MANIFEST_GENERATION" "$MANIFEST_REVISION" "$MANIFEST_NONCE")"
  result_line="$(wait_diag_line "$START_DIAG" "$diag_start" "$result_prefix" "prefix" "$START_ATTEMPTS" "$START_DELAY")" || {
    partial_cleanup
    fail "correlated result marker not observed; refusing on identity mismatch"
  }
  detail="$(check_result_line "$result_line" "$MANIFEST_CORRELATION" "$MANIFEST_OWNER" "$MANIFEST_GENERATION" "$MANIFEST_REVISION" "$MANIFEST_NONCE")" || {
    partial_cleanup
    fail "result detail failed validation; refusing on schema mismatch"
  }
  RECEIPT_PATH="$START_RECEIPT"
  # Exclusive fail-closed receipt creation: real parent dir required above,
  # pre-existing path (including symlinks) refused above, and noclobber
  # guarantees no overwrite of a racing path.
  if [[ -e "$RECEIPT_PATH" || -L "$RECEIPT_PATH" ]]; then
    partial_cleanup
    fail "receipt appeared before exclusive creation; refusing overwrite: $RECEIPT_PATH"
  fi
  (set -o noclobber; printf '{"schema":"%s","plugin":"%s","scriptId":%s,"scriptObject":"%s","bundleSha256":"%s","entrySha256":"%s","querySha256":"%s","owner":"%s","generation":"%s","revision":%s,"correlationId":"%s","nonce":"%s"}\n' \
    "$RECEIPT_SCHEMA" "$PLUGIN" "$SCRIPT_ID" "$SCRIPT_OBJ" "$MANIFEST_BUNDLE_SHA" "$MANIFEST_ENTRY_SHA" "$MANIFEST_QUERY_SHA" \
    "$MANIFEST_OWNER" "$MANIFEST_GENERATION" "$MANIFEST_REVISION" "$MANIFEST_CORRELATION" "$MANIFEST_NONCE" > "$RECEIPT_PATH") || {
    partial_cleanup
    fail "could not write the receipt exclusively"
  }
  RECEIPT_CREATED="1"
  printf 'started: plugin=%s script=%s object=%s correlation=%s owner=%s generation=%s revision=%s\n' \
    "$PLUGIN" "$SCRIPT_ID" "$SCRIPT_OBJ" "$MANIFEST_CORRELATION" "$MANIFEST_OWNER" "$MANIFEST_GENERATION" "$MANIFEST_REVISION"
}

cmd_status() {
  local receipt=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --receipt) [[ -z "$receipt" ]] || fail "duplicate --receipt"; [[ -n "${2:-}" ]] || fail "missing value for --receipt"; receipt="$2"; shift 2 ;;
      *) fail "unknown status flag '$1'" ;;
    esac
  done
  [[ -n "$receipt" ]] || fail "status requires --receipt"
  command -v "$BUSCTL_BIN" >/dev/null 2>&1 || fail "required tool '$BUSCTL_BIN' not found in PATH"
  require_regular_file "$receipt" "receipt"
  local receipt_eval=""
  receipt_eval="$(parse_receipt "$receipt")" || exit 1
  local RECEIPT_PLUGIN="" RECEIPT_SCRIPT_ID="" RECEIPT_SCRIPT_OBJ="" RECEIPT_BUNDLE_SHA="" RECEIPT_ENTRY_SHA="" RECEIPT_QUERY_SHA=""
  local RECEIPT_OWNER="" RECEIPT_GENERATION="" RECEIPT_REVISION="" RECEIPT_CORRELATION="" RECEIPT_NONCE=""
  eval "$receipt_eval"
  local state=""
  state="$(loaded_word "$RECEIPT_PLUGIN")" || exit 1
  printf 'status: plugin=%s script=%s object=%s state=%s correlation=%s owner=%s generation=%s revision=%s\n' \
    "$RECEIPT_PLUGIN" "$RECEIPT_SCRIPT_ID" "$RECEIPT_SCRIPT_OBJ" "$state" "$RECEIPT_CORRELATION" "$RECEIPT_OWNER" "$RECEIPT_GENERATION" "$RECEIPT_REVISION"
}

cmd_diagnostics() {
  local receipt="" diag=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --receipt) [[ -z "$receipt" ]] || fail "duplicate --receipt"; [[ -n "${2:-}" ]] || fail "missing value for --receipt"; receipt="$2"; shift 2 ;;
      --diag-file) [[ -z "$diag" ]] || fail "duplicate --diag-file"; [[ -n "${2:-}" ]] || fail "missing value for --diag-file"; diag="$2"; shift 2 ;;
      *) fail "unknown diagnostics flag '$1'" ;;
    esac
  done
  [[ -n "$receipt" ]] || fail "diagnostics requires --receipt"
  require_regular_file "$receipt" "receipt"
  local receipt_eval=""
  receipt_eval="$(parse_receipt "$receipt")" || exit 1
  local RECEIPT_PLUGIN="" RECEIPT_SCRIPT_ID="" RECEIPT_SCRIPT_OBJ="" RECEIPT_BUNDLE_SHA="" RECEIPT_ENTRY_SHA="" RECEIPT_QUERY_SHA=""
  local RECEIPT_OWNER="" RECEIPT_GENERATION="" RECEIPT_REVISION="" RECEIPT_CORRELATION="" RECEIPT_NONCE=""
  eval "$receipt_eval"
  printf 'diagnostics: plugin=%s script=%s object=%s correlation=%s owner=%s generation=%s revision=%s bundle=%s\n' \
    "$RECEIPT_PLUGIN" "$RECEIPT_SCRIPT_ID" "$RECEIPT_SCRIPT_OBJ" "$RECEIPT_CORRELATION" "$RECEIPT_OWNER" "$RECEIPT_GENERATION" "$RECEIPT_REVISION" "$RECEIPT_BUNDLE_SHA"
  if [[ -n "$diag" ]]; then
    require_regular_file "$diag" "diag file"
    local ready_line result_prefix source_line line found_ready="" found_result="" found_source="" slice=""
    ready_line="plasma-auto-tiler:advisory-describe-ready:$RECEIPT_CORRELATION"
    source_line="$(source_line_for "$RECEIPT_ENTRY_SHA" "$RECEIPT_QUERY_SHA")"
    result_prefix="$(result_prefix_for "$RECEIPT_CORRELATION" "$RECEIPT_OWNER" "$RECEIPT_GENERATION" "$RECEIPT_REVISION" "$RECEIPT_NONCE")"
    slice="$(tail -c 65536 -- "$diag" 2>/dev/null)" || slice=""
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" == "$ready_line" ]]; then found_ready="$line"; fi
      if [[ "$line" == "$source_line" ]]; then found_source="$line"; fi
      if [[ "$line" == "$result_prefix"* ]]; then found_result="$line"; fi
    done <<< "$slice"
    found_ready="$(printf '%s' "$found_ready" | head -c 1024)" || found_ready=""
    found_source="$(printf '%s' "$found_source" | head -c 1024)" || found_source=""
    found_result="$(printf '%s' "$found_result" | head -c 1024)" || found_result=""
    [[ -n "$found_ready" ]] || fail "ready marker for the recorded correlation is absent"
    [[ -n "$found_source" ]] || fail "bound source marker for the recorded identity is absent"
    [[ -n "$found_result" ]] || fail "result marker for the recorded identity is absent"
    check_result_line "$found_result" "$RECEIPT_CORRELATION" "$RECEIPT_OWNER" "$RECEIPT_GENERATION" "$RECEIPT_REVISION" "$RECEIPT_NONCE" >/dev/null || fail "result marker detail failed validation"
    printf 'diagnostics: markers=correlated\n'
  fi
}

cmd_stop() {
  local receipt=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --receipt) [[ -z "$receipt" ]] || fail "duplicate --receipt"; [[ -n "${2:-}" ]] || fail "missing value for --receipt"; receipt="$2"; shift 2 ;;
      *) fail "unknown stop flag '$1'" ;;
    esac
  done
  [[ -n "$receipt" ]] || fail "stop requires --receipt"
  command -v "$BUSCTL_BIN" >/dev/null 2>&1 || fail "required tool '$BUSCTL_BIN' not found in PATH"
  require_regular_file "$receipt" "receipt"
  local receipt_eval=""
  receipt_eval="$(parse_receipt "$receipt")" || exit 1
  local RECEIPT_PLUGIN="" RECEIPT_SCRIPT_ID="" RECEIPT_SCRIPT_OBJ="" RECEIPT_BUNDLE_SHA="" RECEIPT_ENTRY_SHA="" RECEIPT_QUERY_SHA=""
  local RECEIPT_OWNER="" RECEIPT_GENERATION="" RECEIPT_REVISION="" RECEIPT_CORRELATION="" RECEIPT_NONCE=""
  eval "$receipt_eval"
  SCRIPT_ID="$RECEIPT_SCRIPT_ID"
  SCRIPT_OBJ="$RECEIPT_SCRIPT_OBJ"
  if [[ "$(loaded_word "$RECEIPT_PLUGIN")" == "not-loaded" ]]; then
    rm -f -- "$receipt" || fail "could not remove the stale receipt"
    printf 'stopped: plugin=%s script=%s already-absent cleanup=verified\n' "$RECEIPT_PLUGIN" "$RECEIPT_SCRIPT_ID"
    return 0
  fi
  "$BUSCTL_BIN" call "$BUS_DEST" "$SCRIPT_OBJ" "$BUS_SCRIPT_IFACE" stop >/dev/null 2>&1 || true
  local unload_out=""
  unload_out="$("$BUSCTL_BIN" call "$BUS_DEST" "$BUS_PATH" "$BUS_SCRIPTING_IFACE" unloadScript s "$RECEIPT_PLUGIN" 2>/dev/null)" || {
    fail "unloadScript failed for '$RECEIPT_PLUGIN'"
  }
  [[ "$(parse_bool "$unload_out")" == "true" ]] || fail "unloadScript refused '$RECEIPT_PLUGIN'"
  [[ "$(loaded_word "$RECEIPT_PLUGIN")" == "not-loaded" ]] || fail "recorded plugin still loaded after exact unload"
  rm -f -- "$receipt" || fail "could not remove the receipt"
  printf 'stopped: plugin=%s script=%s object=%s cleanup=verified\n' "$RECEIPT_PLUGIN" "$RECEIPT_SCRIPT_ID" "$SCRIPT_OBJ"
}

main() {
  [[ $# -ge 1 ]] || { usage >&2; exit 1; }
  case "$1" in
    --help|-h|help) usage; exit 0 ;;
    start) shift; cmd_start "$@" ;;
    status) shift; cmd_status "$@" ;;
    diagnostics) shift; cmd_diagnostics "$@" ;;
    stop) shift; cmd_stop "$@" ;;
    *) fail "unknown command '$1' (expected start|status|diagnostics|stop|--help)" ;;
  esac
}

main "$@"
